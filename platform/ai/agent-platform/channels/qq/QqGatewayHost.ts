import type { ChannelInboundService } from '../ChannelInboundService'
import { isQqMessageEvent, readQqMessageCreate } from './QqGatewayDispatch'
import type { QqGatewayFrame } from './QqGatewayProtocol'
import { parseQqGatewayFrame } from './QqGatewayProtocol'
import { QqGatewaySession, type QqGatewayClock, type QqGatewayEnd } from './QqGatewaySession'
import { QqRuntimeRepository } from './QqRuntimeRepository'
import { normalizeQqEvent } from './QqUpdateNormalizer'

type Socket = {
  close: () => void
  send: (value: string) => void
  onclose: ((event: unknown) => void) | null
  onerror: ((event: unknown) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
}
type Factory = new (url: string) => Socket

/**
 * QQ 网关宿主：socket ↔ 状态机（`QqGatewaySession`），并负责「断了以后怎么回来」。
 *
 * 与 Discord 那份同形，差别都来自 QQ 自己的文档：
 * - 心跳从 **READY / RESUMED** 起算（「鉴权成功之后，就需要按照周期进行心跳发送」）；
 * - 断开之后走 Resume 还是重新 Identify，看**关闭码表**（状态机给出 `disposition`），
 *   这里只执行结论：`fatal` 就停，`identify` / `resume` 就按退避重连。
 *
 * 最要紧的顺序与 Discord 一致：**先送进管道、管道确认之后才提交序号**。反过来就是永久丢消息。
 */
export class QqGatewayHost {
  private socket: Socket | null = null
  private readonly closed = new WeakSet<object>()
  private session: QqGatewaySession | null = null
  private reconnectTimer: unknown = null
  private attempt = 0
  private stopped = false

  constructor(private readonly deps: {
    channelId: string
    generation: number
    gatewayUrl: string
    /** 官方格式 `QQBot {AccessToken}`，由调用方拼好交进来。 */
    token: () => Promise<string | null>
    intents: number
    inbound: ChannelInboundService
    runtime: QqRuntimeRepository
    createPlatformWebSocket: Factory
    isCurrent: () => boolean
    signal: AbortSignal
    timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout }
    refreshGatewayUrl?: () => Promise<string | null>
  }) {}

  async start(): Promise<void> {
    if (this.stopped || this.session !== null || !this.currentGeneration()) return
    const token = await this.deps.token()
    if (this.stopped || !this.currentGeneration()) return
    if (!token) {
      this.audit('qq-credential-missing')
      return
    }
    this.session = new QqGatewaySession({
      token,
      intents: this.deps.intents,
      clock: this.clock(),
      onEnd: (end) => { this.onEnd(end) }
    })
    this.open(this.deps.gatewayUrl)
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.clearReconnect()
    this.session?.stop()
    this.closeSocket()
    this.session = null
  }

  close(): void {
    this.stopped = true
    this.clearReconnect()
    this.closeSocket()
    this.session = null
  }

  private clock(): QqGatewayClock {
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
      close: () => socket.close()
    })
    socket.onmessage = (event) => { void this.handle(event.data, socket) }
    socket.onerror = () => { if (this.current(socket)) this.audit('qq-gateway-error') }
    socket.onclose = (event) => {
      this.closed.add(socket)
      if (this.socket !== socket) return
      this.socket = null
      session.interrupt(closeCodeOf(event))
    }
    if (!this.deps.signal.aborted) this.deps.signal.addEventListener('abort', () => this.close(), { once: true })
  }

  private async handle(data: unknown, socket: Socket): Promise<void> {
    if (!this.current(socket)) return
    if (typeof data !== 'string') return this.close()
    const frame = parseQqGatewayFrame(data)
    if (!frame) {
      this.audit('qq-gateway-frame-invalid')
      return
    }
    const lifecycle = this.lifecycleDispatch(frame)
    if (lifecycle) {
      this.attempt = 0
      this.commitOrStop(lifecycle.sequence)
      this.session?.receive(frame)
      return
    }
    if (frame.kind === 'dispatch') {
      await this.handleDispatch(frame, socket)
      return
    }
    this.session?.receive(frame)
  }

  private async handleDispatch(frame: Extract<QqGatewayFrame, { kind: 'dispatch' }>, socket: Socket): Promise<void> {
    if (!isQqMessageEvent(frame.event)) {
      // 成员变动、表情、点赞……这一版不投递；读过即消费，否则游标会卡在它们前面。
      this.commitOrStop(frame.sequence)
      return
    }
    const read = readQqMessageCreate(frame.event, frame.data)
    if (read.kind === 'ignored') {
      this.commitOrStop(frame.sequence)
      return
    }
    if (read.kind === 'invalid') {
      this.audit('qq-event-invalid')
      this.commitOrStop(frame.sequence)
      return
    }
    const fact = normalizeQqEvent(read.seam)
    if (!fact) {
      this.audit('qq-event-invalid')
      this.commitOrStop(frame.sequence)
      return
    }
    if ((fact.text === undefined || fact.text.trim().length === 0) && (fact.attachments?.length ?? 0) === 0) {
      // 空壳消息：QQ 侧常见的是平台只推事件、正文没下发（或权限不足）。与「没连上」是两件事。
      this.audit('qq-message-content-empty')
    }

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
          if (!this.current(socket)) throw new Error('qq-gateway-socket-replaced')
          if (!this.commitSequence(frame.sequence)) {
            this.audit('qq-sequence-stale')
            this.close()
            throw new Error('qq-sequence-stale')
          }
          acknowledged = true
        }
      })
    } catch {
      this.audit('qq-inbound-failed')
      return
    }
    if (!this.current(socket)) return
    if (result.disposition === 'retry') {
      // 管道说这条没接住：序号不许前移，等重连补发。
      this.audit('qq-inbound-retry')
      return
    }
    if (!acknowledged) this.commitOrStop(frame.sequence)
  }

  private lifecycleDispatch(frame: QqGatewayFrame): Extract<QqGatewayFrame, { kind: 'dispatch' }> | null {
    return frame.kind === 'dispatch' && (frame.event === 'READY' || frame.event === 'RESUMED') ? frame : null
  }

  private commitSequence(sequence: number): boolean {
    return this.deps.runtime.commitIfCurrent(this.deps.channelId, this.deps.generation, sequence)
  }

  private commitOrStop(sequence: number): void {
    if (this.commitSequence(sequence)) return
    this.audit('qq-sequence-stale')
    this.close()
  }

  private onEnd(end: QqGatewayEnd): void {
    const code = auditCodeFor(end)
    if (code) this.audit(code)
    if (end.kind === 'stopped' || this.stopped || !this.currentGeneration()) return
    // `fatal` = 关闭码表说「连也白连」（参数、权限、沙箱、封禁）：停下，别再撞。
    if (end.disposition === 'fatal') {
      this.close()
      return
    }
    this.attempt += 1
    this.clearReconnect()
    const timers = this.deps.timers ?? { setTimeout, clearTimeout }
    this.reconnectTimer = timers.setTimeout(() => { void this.reconnect() }, backoffMs(this.attempt - 1))
  }

  private async reconnect(): Promise<void> {
    this.reconnectTimer = null
    if (this.stopped || !this.currentGeneration()) return
    let socketUrl = this.deps.gatewayUrl
    if (this.deps.refreshGatewayUrl) {
      try {
        const refreshed = await this.deps.refreshGatewayUrl()
        if (refreshed) socketUrl = refreshed
      } catch {
        this.audit('qq-gateway-url-unavailable')
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

/** 结束原因 → 审计码：两种结束（服务器让重连 / 心跳没回 ACK）必须分得开。 */
function auditCodeFor(end: QqGatewayEnd): string | null {
  switch (end.reason) {
    case 'reconnect-requested': return 'qq-gateway-reconnect'
    case 'heartbeat-timeout': return 'qq-gateway-heartbeat-timeout'
    case 'invalid-session': return end.disposition === 'resume' ? 'qq-gateway-session-resumable' : 'qq-gateway-session-reset'
    case 'close-code':
      if (end.disposition === 'fatal') return 'qq-gateway-close-fatal'
      return end.disposition === 'identify' ? 'qq-gateway-close-identify' : 'qq-gateway-close-resume'
    case 'stopped': return null
  }
}

function closeCodeOf(event: unknown): number | null {
  if (!event || typeof event !== 'object') return null
  const code = (event as { code?: unknown }).code
  return typeof code === 'number' && Number.isInteger(code) ? code : null
}

function backoffMs(attempt: number): number {
  return Math.min(30_000, 1_000 * 2 ** attempt)
}
