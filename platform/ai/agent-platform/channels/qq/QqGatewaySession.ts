import type { QqGatewayFrame } from './QqGatewayProtocol'
import { buildQqHeartbeat, buildQqIdentify, buildQqResume, qqGatewayCloseDisposition } from './QqGatewayProtocol'

/**
 * QQ 机器人网关的**连接层状态机**（帧解析与关闭码判定在 `QqGatewayProtocol`）。
 *
 * 与 Discord 同套 op 码，但两处按官方文档必须不同：
 * - **心跳在鉴权成功之后**才按周期发（「WebSocket 方式」原文：鉴权成功之后，就需要按照周期进行心跳发送），
 *   HELLO 只提供周期；这里不排 jitter——官方没给，就不自己发明。
 * - **断开后走 Resume 还是重新 Identify 看关闭码**，不是一帧布尔值；判定统一放在
 *   `qqGatewayCloseDisposition`，这里只执行它的结论。
 *
 * 这一层不建 socket、不写审计，只把「这次连接怎么结束、下一次该怎么连」交出去。
 */

export type QqGatewayTransport = Readonly<{
  send: (wire: string) => void
  close: (code: number) => void
}>

export type QqGatewayClock = Readonly<{
  setTimer: (delayMs: number, run: () => void) => unknown
  clearTimer: (handle: unknown) => void
}>

export type QqGatewayDisposition = 'resume' | 'identify' | 'fatal'

export type QqGatewayEnd = Readonly<{
  /** failed = 这条连接是坏的或认证被拒；disconnected = 正常断开、去重连；stopped = 人停的。 */
  kind: 'failed' | 'disconnected' | 'stopped'
  reason: 'reconnect-requested' | 'heartbeat-timeout' | 'invalid-session' | 'close-code' | 'stopped'
  closeCode: number | null
  /** 下一跳：resume / identify / fatal（fatal 别再连，去处理环境、权限或封禁）。 */
  disposition: QqGatewayDisposition
}>

export type QqGatewayConnectPlan =
  | Readonly<{ kind: 'identify' }>
  | Readonly<{ kind: 'resume'; sessionId: string; sequence: number }>

export type QqGatewayPhase = 'awaiting-hello' | 'identifying' | 'resuming' | 'ready' | 'ended'

export type QqGatewaySessionDeps = Readonly<{
  /** 官方格式 `QQBot {AccessToken}`，由调用方拼好交进来。 */
  token: string
  intents: number
  clock: QqGatewayClock
  onEnd: (end: QqGatewayEnd) => void
}>

export class QqGatewaySession {
  private transport: QqGatewayTransport | null = null
  private phase: QqGatewayPhase = 'ended'
  private stopped = false
  private intervalMs: number | null = null
  private heartbeatTimer: unknown = null
  private awaitingAck = false
  private sequence: number | null = null
  private sessionId: string | null = null

  constructor(private readonly deps: QqGatewaySessionDeps) {}

  get currentPhase(): QqGatewayPhase {
    return this.phase
  }

  attach(transport: QqGatewayTransport): void {
    if (this.stopped) throw new Error('qq-gateway-session-stopped')
    if (this.transport) throw new Error('qq-gateway-session-already-attached')
    this.transport = transport
    this.phase = 'awaiting-hello'
    this.intervalMs = null
    this.awaitingAck = false
    this.clearHeartbeat()
  }

  receive(frame: QqGatewayFrame): void {
    if (this.stopped || !this.transport || this.phase === 'ended') return
    switch (frame.kind) {
      case 'hello':
        if (this.phase === 'awaiting-hello') this.onHello(frame.heartbeatIntervalMs)
        return
      case 'heartbeat':
        // 「客户端或服务端发送心跳」：服务端要一次就立刻回一次，带的仍是最后收到的 s。
        this.sendHeartbeat()
        return
      case 'heartbeat-ack':
        this.awaitingAck = false
        return
      case 'dispatch':
        this.onDispatch(frame)
        return
      case 'reconnect':
        // 「服务端通知客户端重新连接」：文档说断开重连后发 Resume 即可，不必重新登录。
        this.end('disconnected', 'reconnect-requested', null, 'resume')
        return
      case 'invalid-session':
        this.onInvalidSession(frame.resumable)
        return
      case 'unknown':
        return
    }
  }

  /**
   * 传输自己断了（或对端给了关闭码）。按官方那张表判下一步；`fatal` 由宿主负责别再连。
   */
  interrupt(closeCode: number | null): void {
    if (closeCode === null) {
      // 没有关闭码 = 本地感知到的断开，按传输层关闭处理：Resume 补发漏掉的事件。
      this.end('disconnected', 'close-code', null, 'resume')
      return
    }
    const disposition = qqGatewayCloseDisposition(closeCode)
    if (disposition === 'identify') this.forgetSession()
    this.end(disposition === 'resume' ? 'disconnected' : 'failed', 'close-code', closeCode, disposition)
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.forgetSession()
    this.end('stopped', 'stopped', null, 'identify')
  }

  nextPlan(): QqGatewayConnectPlan {
    if (this.sessionId !== null && this.sequence !== null) {
      return Object.freeze({ kind: 'resume', sessionId: this.sessionId, sequence: this.sequence })
    }
    return Object.freeze({ kind: 'identify' })
  }

  private onHello(intervalMs: number): void {
    this.intervalMs = intervalMs
    const plan = this.nextPlan()
    if (plan.kind === 'resume') {
      this.phase = 'resuming'
      this.send(buildQqResume(this.deps.token, plan.sessionId, plan.sequence))
    } else {
      this.phase = 'identifying'
      this.send(buildQqIdentify(this.deps.token, this.deps.intents))
    }
    // 心跳从 READY / RESUMED 起算，见文件头注释。
  }

  private onDispatch(frame: Extract<QqGatewayFrame, { kind: 'dispatch' }>): void {
    this.sequence = frame.sequence
    if (frame.event === 'READY') {
      const sessionId = readQqSessionId(frame.data)
      if (sessionId) this.sessionId = sessionId
      this.phase = 'ready'
      this.startHeartbeat()
      return
    }
    if (frame.event === 'RESUMED') {
      this.phase = 'ready'
      this.startHeartbeat()
    }
  }

  private onInvalidSession(resumable: boolean | null): void {
    // 官方只写「identify 或 resume 参数有错时返回」：只有明确说可恢复才保留材料，其余一律重来。
    const canResume = resumable === true && this.sessionId !== null && this.sequence !== null
    if (!canResume) this.forgetSession()
    this.end('failed', 'invalid-session', null, canResume ? 'resume' : 'identify')
  }

  private startHeartbeat(): void {
    const intervalMs = this.intervalMs
    if (intervalMs === null || intervalMs <= 0) return
    this.scheduleHeartbeat(intervalMs)
  }

  private onHeartbeatDue(): void {
    this.heartbeatTimer = null
    if (this.stopped || this.phase === 'ended') return
    if (this.awaitingAck) {
      // 官方没有给「心跳没回 ACK」规定关闭码，这里主动关掉、按 Resume 补事件。
      this.end('failed', 'heartbeat-timeout', null, 'resume')
      return
    }
    this.sendHeartbeat()
    const intervalMs = this.intervalMs
    if (intervalMs !== null && intervalMs > 0) this.scheduleHeartbeat(intervalMs)
  }

  private sendHeartbeat(): void {
    this.send(buildQqHeartbeat(this.sequence))
    this.awaitingAck = true
  }

  private scheduleHeartbeat(delayMs: number): void {
    this.clearHeartbeat()
    this.heartbeatTimer = this.deps.clock.setTimer(delayMs, () => { this.onHeartbeatDue() })
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer === null) return
    this.deps.clock.clearTimer(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  private forgetSession(): void {
    this.sessionId = null
    this.sequence = null
  }

  private end(
    kind: QqGatewayEnd['kind'],
    reason: QqGatewayEnd['reason'],
    closeCode: number | null,
    disposition: QqGatewayDisposition
  ): void {
    if (this.phase === 'ended') return
    this.phase = 'ended'
    this.clearHeartbeat()
    this.intervalMs = null
    this.awaitingAck = false
    const transport = this.transport
    this.transport = null
    if (closeCode !== null) transport?.close(closeCode)
    this.deps.onEnd(Object.freeze({ kind, reason, closeCode, disposition }))
  }

  private send(wire: string): void {
    this.transport?.send(wire)
  }
}

function readQqSessionId(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null
  const value = (data as { session_id?: unknown }).session_id
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value) ? value : null
}
