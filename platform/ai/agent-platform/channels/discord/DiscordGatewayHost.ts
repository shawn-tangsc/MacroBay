import type { ChannelInboundService } from '../ChannelInboundService'
import { readDiscordMessageCreate } from './DiscordGatewayDispatch'
import type { DiscordGatewayFrame } from './DiscordGatewayProtocol'
import { parseDiscordGatewayFrame } from './DiscordGatewayProtocol'
import { DiscordGatewaySession, type DiscordGatewayClock, type DiscordGatewayEnd } from './DiscordGatewaySession'
import { DiscordRuntimeRepository } from './DiscordRuntimeRepository'
import { normalizeDiscordEvent } from './DiscordUpdateNormalizer'

type Socket = {
  close: () => void
  send: (value: string) => void
  onclose: ((event: unknown) => void) | null
  onerror: ((event: unknown) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
}
type Factory = new (url: string) => Socket

/**
 * Discord 网关宿主：把 socket 接到状态机（`DiscordGatewaySession`）上，并负责「断了以后怎么回来」。
 *
 * 这一层负责三件事——开/关 socket、把结束原因写成审计、按退避排下一次连接；外加一条最要紧的顺序：
 * **先送进管道、管道确认之后才提交序号**。反过来（先提交再投递）就等于告诉网关「这条我处理过了」，
 * 一次投递失败就永久丢消息，重连也补不回来。
 *
 * 消息类事件由 `DiscordGatewayDispatch` 压成有界形状，去重键来自 `message.id` 本身。
 * 机器人自己发的消息会被网关回显给我们：那一条「忽略」并且推进序号——它是我们自己消费掉的，
 * 不是坏帧，也不该每发一条消息就写一行审计。
 *
 * 时间与 socket 都可注入：用例用假时钟、假 socket 确定性重跑心跳与退避，一条真连接都不开。
 */
export class DiscordGatewayHost {
  private socket: Socket | null = null
  private readonly closed = new WeakSet<object>()
  private session: DiscordGatewaySession | null = null
  private reconnectTimer: unknown = null
  private attempt = 0
  private stopped = false
  /** 「自己的回显到了」只记一次：它是出站通路的证据，不是每条消息一行日志。 */
  private selfEchoObserved = false

  constructor(private readonly deps: {
    channelId: string
    generation: number
    gatewayUrl: string
    /** 凭据只在内存里读；这里拿不到就一条连接都不开。 */
    token: () => Promise<string | null>
    intents: number
    inbound: ChannelInboundService
    /** 机器人自己的 id（`/users/@me`）：判断「这条消息是不是在叫我」。拿不到时只有私信算叫我。 */
    botUserId: string | null
    runtime: DiscordRuntimeRepository
    createPlatformWebSocket: Factory
    isCurrent: () => boolean
    signal: AbortSignal
    timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout }
    /** 第一个心跳的随机抖动（官方 0..1）。只为用例确定性而注入；生产走默认 `Math.random`。 */
    jitter?: () => number
    /** 重连时重新取接入点（`/gateway/bot`）；取不到就沿用上一个。 */
    refreshGatewayUrl?: () => Promise<string | null>
  }) {}

  async start(): Promise<void> {
    if (this.stopped || this.session !== null || !this.currentGeneration()) return
    const token = await this.deps.token()
    // 等凭据的这段时间里可能已经被停用/换代：回来再判一次，别开一条已经过期的连接。
    if (this.stopped || !this.currentGeneration()) return
    if (!token) {
      this.audit('discord-credential-missing')
      return
    }
    this.session = new DiscordGatewaySession({
      token,
      intents: this.deps.intents,
      clock: this.clock(),
      ...(this.deps.jitter ? { jitter: this.deps.jitter } : {}),
      onEnd: (end) => { this.onEnd(end) }
    })
    this.open(this.deps.gatewayUrl)
  }

  /** 人停的：不再重连，会话材料一起丢掉。 */
  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.clearReconnect()
    this.session?.stop()
    this.closeSocket()
    this.session = null
  }

  /** 传输侧关闭（换代/停用）：不当成一次失败，也不排重连。 */
  close(): void {
    this.stopped = true
    this.clearReconnect()
    this.closeSocket()
    this.session = null
  }

  private clock(): DiscordGatewayClock {
    const timers = this.deps.timers ?? { setTimeout, clearTimeout }
    return {
      setTimer: (delayMs, run) => timers.setTimeout(run, delayMs),
      clearTimer: (handle) => timers.clearTimeout(handle as Parameters<typeof clearTimeout>[0])
    }
  }

  private open(socketUrl: string): void {
    if (this.stopped || !this.currentGeneration()) return
    const session = this.session
    if (!session) return
    this.closeSocket()
    const socket = new this.deps.createPlatformWebSocket(socketUrl)
    this.socket = socket
    session.attach({
      send: (wire) => socket.send(wire),
      // 状态机自己关连接时把关闭码带出去；我们的 socket 抽象不转交它，但顺序仍然是「先关后退」。
      close: () => socket.close()
    })
    socket.onmessage = (event) => { this.handle(event.data, socket) }
    socket.onerror = () => { if (this.current(socket)) this.audit('discord-gateway-error') }
    socket.onclose = (event) => {
      this.closed.add(socket)
      if (this.socket !== socket) return
      this.socket = null
      // 传输自己断了：关闭码是唯一能把「intent 没授权 / Token 不对 / 连得太急 / 普通掉线」分开的线索。
      session.interrupt(closeCodeOf(event))
    }
    if (!this.deps.signal.aborted) this.deps.signal.addEventListener('abort', () => this.close(), { once: true })
  }

  private handle(data: unknown, socket: Socket): void {
    if (!this.current(socket)) return
    // Discord 网关只发文本帧；二进制帧说明不是我们认识的协议，宁可断开也别猜。
    if (typeof data !== 'string') return this.close()
    const frame = parseDiscordGatewayFrame(data)
    if (!frame) {
      this.audit('discord-gateway-frame-invalid')
      return
    }
    const lifecycle = this.lifecycleDispatch(frame)
    if (lifecycle) {
      // 连上了：退避计数从头算。
      this.attempt = 0
      this.commitOrStop(lifecycle.sequence)
      this.session?.receive(frame)
      return
    }
    if (frame.kind === 'dispatch') {
      void this.handleDispatch(frame, socket)
      return
    }
    this.session?.receive(frame)
  }

  /** 一条 dispatch 的处理：消息进管道，其余事件读过就算消费。序号只在确认之后推进。 */
  private async handleDispatch(frame: Extract<DiscordGatewayFrame, { kind: 'dispatch' }>, socket: Socket): Promise<void> {
    if (frame.event !== 'MESSAGE_CREATE') {
      // 成员变更、表情、正在输入……这一版不投递它们；读过即消费，不然游标会永远卡在它们前面。
      this.commitOrStop(frame.sequence)
      return
    }
    const read = readDiscordMessageCreate(frame.data, this.deps.botUserId)
    if (read.kind === 'self-echo') {
      // 我们自己发出去、又被回显的那条：**不投递**（否则机器人回自己的话），但要留一条痕迹——
      // 这是「出站真的到了 Discord」的现场证据。每条连接只记第一次，避免每发一条消息一行日志。
      if (!this.selfEchoObserved) {
        this.selfEchoObserved = true
        this.audit('discord-self-echo-observed')
      }
      this.commitOrStop(frame.sequence)
      return
    }
    if (read.kind === 'ignored') {
      // 别的机器人发的：消费掉，不投递、不审计。
      this.commitOrStop(frame.sequence)
      return
    }
    if (read.kind === 'invalid') {
      // 读不懂的消息体：重放也读不懂，记一条并消费掉，别让它把后面所有消息都堵在游标后面。
      this.audit('discord-event-invalid')
      this.commitOrStop(frame.sequence)
      return
    }
    const fact = normalizeDiscordEvent(read.seam)
    if (!fact) {
      this.audit('discord-event-invalid')
      this.commitOrStop(frame.sequence)
      return
    }
    if ((fact.text === undefined || fact.text.trim().length === 0) && (fact.attachments?.length ?? 0) === 0) {
      // 空壳消息。最常见的原因是开发者后台没给这个 bot 打开 **Message Content** 这个特权 intent：
      // 连接正常、事件也到了，只有正文不在。不写这一行，读者只会看到「消息进来了但没有内容」，
      // 分不清是适配器坏了还是后台少点了一个开关。
      this.audit('discord-message-content-empty')
    }

    /** 管道在**落库之后**才调它；序号提交挂在这里，才真正是「先入管道、再提序号」。 */
    let acknowledged = false
    let result: Awaited<ReturnType<ChannelInboundService['receive']>>
    try {
      result = await this.deps.inbound.receive({
        channelId: this.deps.channelId,
        generation: this.deps.generation,
        providerEventKey: fact.eventKey,
        providerConversationKey: fact.conversationKey,
        providerUserKey: fact.userKey,
        conversationKind: fact.conversationKind,
        mentionedBot: fact.mentionedBot,
        ...(fact.text === undefined ? {} : { text: fact.text }),
        ...(fact.attachments ? { attachments: fact.attachments } : {}),
        acknowledge: async () => {
          // 连接已经被换掉：这条确认对不上任何现役 socket，抛出去让管道按 retry 处理。
          if (!this.current(socket)) throw new Error('discord-gateway-socket-replaced')
          if (!this.deps.runtime.commitIfCurrent(this.deps.channelId, this.deps.generation, frame.sequence)) {
            this.audit('discord-sequence-stale')
            this.close()
            throw new Error('discord-sequence-stale')
          }
          acknowledged = true
        }
      })
    } catch {
      this.audit('discord-inbound-failed')
      return
    }
    if (!this.current(socket)) return
    if (result.disposition === 'retry') {
      // 管道说这条没接住：序号**不许**前移，让它下次重连时被补发。
      this.audit('discord-inbound-retry')
      return
    }
    // 兜底：管道没走 acknowledge 也算这条已消费（正常路径下不会发生，宁可推进也别把游标卡死）。
    if (!acknowledged) this.commitOrStop(frame.sequence)
  }

  /** 提交序号；被拒（旧代际）就记一条并立刻停，别继续消费一条已经过期连接上的帧。 */
  private commitOrStop(sequence: number): void {
    if (this.commitSequence(sequence)) return
    this.audit('discord-sequence-stale')
    this.close()
  }

  /** 返回帧本身而不是 boolean：用类型谓词说「false 就不是 dispatch」会把后面那条分支判成不可达。 */
  private lifecycleDispatch(frame: DiscordGatewayFrame): Extract<DiscordGatewayFrame, { kind: 'dispatch' }> | null {
    return frame.kind === 'dispatch' && (frame.event === 'READY' || frame.event === 'RESUMED') ? frame : null
  }

  /** 序号落库的唯一入口：`commitIfCurrent` 同时是鉴权（代际/启用状态），过期的写一律返回 false。 */
  private commitSequence(sequence: number): boolean {
    return this.deps.runtime.commitIfCurrent(this.deps.channelId, this.deps.generation, sequence)
  }

  private onEnd(end: DiscordGatewayEnd): void {
    const code = auditCodeFor(end)
    if (code) this.audit(code)
    if (end.kind === 'stopped' || this.stopped || !this.currentGeneration()) return
    // 有两类结束，重连多少次都不会变好：intent 没被授权、凭据被拒。停下并留一句人话，
    // 别让它每 30 秒撞一次墙、把真正的线索埋在一串「重连中」里。
    if (end.reason === 'intents-disallowed' || end.reason === 'credential-rejected') {
      this.close()
      return
    }
    const delay = Math.max(end.retryAfterMs, backoffMs(this.attempt))
    this.attempt += 1
    this.clearReconnect()
    const timers = this.deps.timers ?? { setTimeout, clearTimeout }
    this.reconnectTimer = timers.setTimeout(() => { void this.reconnect() }, delay)
  }

  private async reconnect(): Promise<void> {
    this.reconnectTimer = null
    if (this.stopped || !this.currentGeneration()) return
    let socketUrl = this.deps.gatewayUrl
    const plan = this.session?.nextPlan()
    if (plan?.kind === 'resume' && plan.gatewayUrl) socketUrl = plan.gatewayUrl
    if (this.deps.refreshGatewayUrl) {
      try {
        const refreshed = await this.deps.refreshGatewayUrl()
        if (refreshed) socketUrl = refreshed
      } catch {
        // 取不到新地址就沿用旧的：一次读失败不该让通道停在那儿。
        this.audit('discord-gateway-url-unavailable')
      }
    }
    if (this.stopped || !this.currentGeneration()) return
    this.open(socketUrl)
  }

  private clearReconnect(): void {
    if (this.reconnectTimer === null) return
    const timers = this.deps.timers ?? { setTimeout, clearTimeout }
    timers.clearTimeout(this.reconnectTimer as Parameters<typeof clearTimeout>[0])
    this.reconnectTimer = null
  }

  private closeSocket(): void {
    const socket = this.socket
    this.socket = null
    if (!socket) return
    this.closed.add(socket)
    socket.close()
  }

  private currentGeneration(): boolean {
    return !this.deps.signal.aborted && this.deps.isCurrent()
  }

  private current(socket: Socket): boolean {
    return this.currentGeneration() && this.socket === socket && !this.closed.has(socket)
  }

  private audit(code: string): void {
    if (!this.currentGeneration()) return
    this.deps.runtime.auditIfCurrent(this.deps.channelId, this.deps.generation, code)
  }
}

/**
 * 结束原因 → 审计码。**两种结束不共用一条**：服务器让重连（op 7）是正常事，
 * 心跳没回 ACK 才是这条连接坏了——读者看日志时这两句必须分得开。
 */
function auditCodeFor(end: DiscordGatewayEnd): string | null {
  switch (end.reason) {
    case 'reconnect-requested': return 'discord-gateway-reconnect'
    case 'heartbeat-timeout': return 'discord-gateway-zombie'
    case 'invalid-session-resume': return 'discord-gateway-session-resumable'
    case 'invalid-session-reidentify': return 'discord-gateway-session-reset'
    case 'intents-disallowed': return 'discord-intents-disallowed'
    case 'credential-rejected': return 'discord-credential-rejected'
    case 'rate-limited-close': return 'discord-gateway-rate-limited'
    case 'transport-closed': return 'discord-gateway-transport-closed'
    case 'stopped': return null
  }
}

/** 关闭事件里的码：`ws` 与浏览器样式都会带，读不懂就当没有（按普通掉线处理）。 */
function closeCodeOf(event: unknown): number | null {
  if (!event || typeof event !== 'object') return null
  const code = (event as { code?: unknown }).code
  return typeof code === 'number' && Number.isInteger(code) ? code : null
}

/** 1s → 2s → 4s …… 封顶 30s：与平台其余轮询宿主同一节奏，别为一家发明另一套。 */
function backoffMs(attempt: number): number {
  return Math.min(30_000, 1_000 * 2 ** attempt)
}
