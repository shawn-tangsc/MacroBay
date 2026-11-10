import type { DiscordGatewayFrame } from './DiscordGatewayProtocol'
import { parseDiscordGatewayFrame } from './DiscordGatewayProtocol'
import { DiscordGatewaySession, type DiscordGatewayClock, type DiscordGatewayEnd } from './DiscordGatewaySession'
import { DiscordRuntimeRepository } from './DiscordRuntimeRepository'

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
 * 这一层**不解析业务事件**：帧解析交给 `DiscordGatewayProtocol`，连接语义交给状态机，它自己只管
 * 三件事——开/关 socket、把结束原因写成审计、按退避排下一次连接。
 * 消息类 dispatch 留到下一笔接进管道；**在那之前一个字节都不提交序号**，否则游标会跨过一条没送进
 * 管道的消息，重连后就永远补不回来。
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

  constructor(private readonly deps: {
    channelId: string
    generation: number
    gatewayUrl: string
    /** 凭据只在内存里读；这里拿不到就一条连接都不开。 */
    token: () => Promise<string | null>
    intents: number
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
    socket.onclose = () => {
      this.closed.add(socket)
      if (this.socket !== socket) return
      this.socket = null
      // 传输自己断了：保留 Resume 材料，交给状态机收尾（它会带出 retryAfterMs）。
      session.interrupt()
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
    if (this.isLifecycleDispatch(frame)) {
      // 连上了：退避计数从头算。
      this.attempt = 0
      if (!this.commitSequence(frame.sequence)) {
        // 旧代际：这条连接已经不属于当前运行时，写入被丢弃后**立刻停**，别继续消费它的帧。
        this.audit('discord-sequence-stale')
        this.close()
        return
      }
    }
    this.session?.receive(frame)
  }

  private isLifecycleDispatch(frame: DiscordGatewayFrame): frame is Extract<DiscordGatewayFrame, { kind: 'dispatch' }> {
    return frame.kind === 'dispatch' && (frame.event === 'READY' || frame.event === 'RESUMED')
  }

  /** 序号落库的唯一入口：`commitIfCurrent` 同时是鉴权（代际/启用状态），过期的写一律返回 false。 */
  private commitSequence(sequence: number): boolean {
    return this.deps.runtime.commitIfCurrent(this.deps.channelId, this.deps.generation, sequence)
  }

  private onEnd(end: DiscordGatewayEnd): void {
    const code = auditCodeFor(end)
    if (code) this.audit(code)
    if (end.kind === 'stopped' || this.stopped || !this.currentGeneration()) return
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
    case 'transport-closed': return 'discord-gateway-transport-closed'
    case 'stopped': return null
  }
}

/** 1s → 2s → 4s …… 封顶 30s：与平台其余轮询宿主同一节奏，别为一家发明另一套。 */
function backoffMs(attempt: number): number {
  return Math.min(30_000, 1_000 * 2 ** attempt)
}
