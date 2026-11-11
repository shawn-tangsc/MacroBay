import type { DiscordGatewayFrame } from './DiscordGatewayProtocol'

/**
 * Discord Gateway 的**连接层状态机**。帧解析在 `DiscordGatewayProtocol`，这里只回答三件事：
 * 这条连接现在该发什么、心跳按什么节奏发、这次断开算不算故障。
 *
 * 协议依据（Discord Developers › Docs › Topical › Gateway）：
 * - **Connecting to the Gateway / Heartbeat**：收到 `HELLO`(10) 之后，每 `d.heartbeat_interval` 毫秒发一次
 *   `HEARTBEAT`(1)，第一个心跳在 `interval × jitter`（jitter 为 0..1 的随机数）之后；两次心跳之间若没收到
 *   `HEARTBEAT ACK`(11)，说明这条连接已经是僵尸，关闭码用 `4000` 并立刻重连。
 * - **Identify Structure**：`{ op: 2, d: { token, intents, properties } }`。
 * - **Resume Structure**：`{ op: 6, d: { token, session_id, seq } }`，`seq` 是最后收到的 `s`。
 * - **Invalid Session**（op 9）：`d` 为 `true` 表示可以 Resume，`false` 表示必须丢掉会话重新 Identify；
 *   文档要求两种情况都先等 1–5 秒再重连。
 * - **Reconnect**（op 7）：服务器要求客户端断开并重连，随后照常 Resume。
 *
 * 这一层不创建 socket（宿主用 `attach` 交进来），也不写审计：它把「这次连接是怎么结束的」作为
 * `DiscordGatewayEnd` 交出去，由宿主决定记哪个码、退避多久。
 */

export type DiscordGatewayTransport = Readonly<{
  send: (wire: string) => void
  close: (code: number) => void
}>

export type DiscordGatewayClock = Readonly<{
  setTimer: (delayMs: number, run: () => void) => unknown
  clearTimer: (handle: unknown) => void
}>

/** 官方给「心跳没回 ACK 的僵尸连接」的关闭码。 */
export const DISCORD_ZOMBIE_CLOSE_CODE = 4_000
/** 官方要求 Invalid Session 之后等 1–5 秒再重连；取固定 2000ms，写死好对账，不掷随机。 */
export const DISCORD_INVALID_SESSION_RETRY_MS = 2_000
/** 主动重连是正常断开，不是故障。 */
const NORMAL_CLOSE_CODE = 1_000
/** HELLO 之前不该出现心跳请求，出现也不理会（协议上不可能）。 */

export type DiscordGatewayEndReason =
  | 'reconnect-requested'
  | 'heartbeat-timeout'
  | 'invalid-session-resume'
  | 'invalid-session-reidentify'
  /** 关闭码 4013 / 4014：这个 bot 没被授权这些 intent，重连多少次都一样。 */
  | 'intents-disallowed'
  /** 关闭码 4003 / 4004：Token 不对或被吊销。 */
  | 'credential-rejected'
  /** 关闭码 4008：连得太急。 */
  | 'rate-limited-close'
  | 'transport-closed'
  | 'stopped'

export type DiscordGatewayEnd = Readonly<{
  /** failed = 这条连接是坏的（僵尸心跳）；disconnected = 服务器要求或传输自己断了；stopped = 人停的。 */
  kind: 'failed' | 'disconnected' | 'stopped'
  reason: DiscordGatewayEndReason
  closeCode: number | null
  /** 下一次连接前要等的毫秒数。状态机不起重连定时器，交给宿主编排。 */
  retryAfterMs: number
}>

export type DiscordGatewayConnectPlan =
  | Readonly<{ kind: 'identify' }>
  | Readonly<{ kind: 'resume'; sessionId: string; sequence: number; gatewayUrl: string | null }>

export type DiscordGatewayPhase = 'awaiting-hello' | 'identifying' | 'resuming' | 'ready' | 'ended'

export type DiscordGatewaySessionDeps = Readonly<{
  token: string
  intents: number
  clock: DiscordGatewayClock
  onEnd: (end: DiscordGatewayEnd) => void
  /** 第一个心跳的随机抖动，官方要求 0..1；默认 `Math.random`，用例注入定值。 */
  jitter?: () => number
}>

export class DiscordGatewaySession {
  private transport: DiscordGatewayTransport | null = null
  private phase: DiscordGatewayPhase = 'ended'
  private stopped = false
  private intervalMs: number | null = null
  private heartbeatTimer: unknown = null
  private awaitingAck = false
  private sequence: number | null = null
  private sessionId: string | null = null
  private resumeGatewayUrl: string | null = null

  constructor(private readonly deps: DiscordGatewaySessionDeps) {}

  get currentPhase(): DiscordGatewayPhase {
    return this.phase
  }

  /** 新连接就绪。收到 HELLO 之前一个字节都不发——IDENTIFY 提前发会被网关直接断开。 */
  attach(transport: DiscordGatewayTransport): void {
    if (this.stopped) throw new Error('discord-gateway-session-stopped')
    if (this.transport) throw new Error('discord-gateway-session-already-attached')
    this.transport = transport
    this.phase = 'awaiting-hello'
    this.intervalMs = null
    this.awaitingAck = false
    this.clearHeartbeat()
  }

  receive(frame: DiscordGatewayFrame): void {
    if (this.stopped || !this.transport || this.phase === 'ended') return
    switch (frame.kind) {
      case 'hello':
        // 同一连接上重复的 HELLO 只认第一次：第二次重排心跳会把已发的节奏打乱。
        if (this.phase === 'awaiting-hello') this.onHello(frame.heartbeatIntervalMs)
        return
      case 'heartbeat':
        // 服务器也可以要求「立刻心跳一次」，带的仍是最后收到的 s。
        if (this.phase !== 'awaiting-hello') this.sendHeartbeat()
        return
      case 'heartbeat-ack':
        this.awaitingAck = false
        return
      case 'dispatch':
        this.onDispatch(frame)
        return
      case 'reconnect':
        this.end('disconnected', 'reconnect-requested', NORMAL_CLOSE_CODE, 0)
        return
      case 'invalid-session':
        this.onInvalidSession(frame.resumable)
        return
      case 'unknown':
        return
    }
  }

  /**
   * 传输自己断了（error / 对端关闭）：保留 Resume 材料，下一条连接直接 Resume。
   *
   * `closeCode` 是唯一能把三种「连不上」分开的线索（Discord 文档的 Close Event Codes）：
   * 4013 / 4014 是 intent 没被授权、4003 / 4004 是凭据不对、4008 是连得太急，
   * 其余（1000 / 1006 这类传输层关闭）才走 Resume。不分辨的话，读者只会看到「一直在重连」。
   */
  interrupt(closeCode: number | null = null): void {
    if (closeCode === 4_013 || closeCode === 4_014) {
      this.end('failed', 'intents-disallowed', closeCode, 0)
      return
    }
    if (closeCode === 4_003 || closeCode === 4_004) {
      this.end('failed', 'credential-rejected', closeCode, 0)
      return
    }
    if (closeCode === 4_008) {
      this.end('failed', 'rate-limited-close', closeCode, 0)
      return
    }
    this.end('disconnected', 'transport-closed', null, 0)
  }

  /** 人停掉的：会话材料一起丢掉，下一条连接必须干净地重新 IDENTIFY。 */
  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.sessionId = null
    this.sequence = null
    this.resumeGatewayUrl = null
    this.end('stopped', 'stopped', null, 0)
  }

  /** 下一条连接该发什么——由手上还有没有可用的会话材料决定。 */
  nextPlan(): DiscordGatewayConnectPlan {
    if (this.sessionId !== null && this.sequence !== null) {
      return Object.freeze({ kind: 'resume', sessionId: this.sessionId, sequence: this.sequence, gatewayUrl: this.resumeGatewayUrl })
    }
    return Object.freeze({ kind: 'identify' })
  }

  private onHello(intervalMs: number): void {
    this.intervalMs = intervalMs
    const plan = this.nextPlan()
    if (plan.kind === 'resume') {
      this.phase = 'resuming'
      this.send(buildDiscordResume(this.deps.token, plan.sessionId, plan.sequence))
    } else {
      this.phase = 'identifying'
      this.send(buildDiscordIdentify(this.deps.token, this.deps.intents))
    }
    this.scheduleHeartbeat(this.firstHeartbeatDelay(intervalMs))
  }

  private onDispatch(frame: Extract<DiscordGatewayFrame, { kind: 'dispatch' }>): void {
    this.sequence = frame.sequence
    if (frame.event === 'READY') {
      // READY 没带可用会话信息也留着连接：顶多下一次重新 IDENTIFY，不值得为此断线。
      const session = readDiscordReadySession(frame.data)
      if (session) {
        this.sessionId = session.sessionId
        this.resumeGatewayUrl = session.gatewayUrl
      }
      this.phase = 'ready'
      return
    }
    if (frame.event === 'RESUMED') this.phase = 'ready'
  }

  private onInvalidSession(resumable: boolean): void {
    // 「可以 Resume」也得手上真有材料；假的可恢复等于重新 Identify。
    const canResume = resumable && this.sessionId !== null && this.sequence !== null
    if (!canResume) {
      this.sessionId = null
      this.sequence = null
    }
    this.end(
      'disconnected',
      canResume ? 'invalid-session-resume' : 'invalid-session-reidentify',
      NORMAL_CLOSE_CODE,
      DISCORD_INVALID_SESSION_RETRY_MS
    )
  }

  private firstHeartbeatDelay(intervalMs: number): number {
    const jitter = this.deps.jitter ?? Math.random
    const value = Math.min(1, Math.max(0, jitter()))
    return Math.floor(intervalMs * value)
  }

  private onHeartbeatDue(): void {
    this.heartbeatTimer = null
    if (this.stopped || this.phase === 'ended') return
    if (this.awaitingAck) {
      this.end('failed', 'heartbeat-timeout', DISCORD_ZOMBIE_CLOSE_CODE, 0)
      return
    }
    this.sendHeartbeat()
    const intervalMs = this.intervalMs
    if (intervalMs !== null && intervalMs > 0) this.scheduleHeartbeat(intervalMs)
  }

  private sendHeartbeat(): void {
    this.send(buildDiscordHeartbeat(this.sequence))
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

  private end(
    kind: DiscordGatewayEnd['kind'],
    reason: DiscordGatewayEndReason,
    closeCode: number | null,
    retryAfterMs: number
  ): void {
    if (this.phase === 'ended') return
    this.phase = 'ended'
    this.clearHeartbeat()
    this.intervalMs = null
    this.awaitingAck = false
    const transport = this.transport
    this.transport = null
    if (closeCode !== null) transport?.close(closeCode)
    this.deps.onEnd(Object.freeze({ kind, reason, closeCode, retryAfterMs }))
  }

  private send(wire: string): void {
    this.transport?.send(wire)
  }
}

export function buildDiscordIdentify(token: string, intents: number): string {
  return JSON.stringify({
    op: 2,
    d: { token, intents, properties: { os: 'desktop', browser: 'MacroBay', device: 'MacroBay' } }
  })
}

export function buildDiscordResume(token: string, sessionId: string, sequence: number): string {
  return JSON.stringify({ op: 6, d: { token, session_id: sessionId, seq: sequence } })
}

export function buildDiscordHeartbeat(sequence: number | null): string {
  return JSON.stringify({ op: 1, d: sequence })
}

function readDiscordReadySession(data: unknown): { sessionId: string; gatewayUrl: string | null } | null {
  if (typeof data !== 'object' || data === null) return null
  const value = data as { session_id?: unknown; resume_gateway_url?: unknown }
  if (typeof value.session_id !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(value.session_id)) return null
  return { sessionId: value.session_id, gatewayUrl: readResumeGatewayUrl(value.resume_gateway_url) }
}

function readResumeGatewayUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  try {
    const url = new URL(value)
    // 只认 wss：服务器若给 http/javascript 之类的回连地址，宁可回基础地址也不照它连。
    return url.protocol === 'wss:' && url.hostname.length > 0 ? value : null
  } catch {
    return null
  }
}
