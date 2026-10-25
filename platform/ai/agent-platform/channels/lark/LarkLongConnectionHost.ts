import type { ChannelInboundService } from '../ChannelInboundService'
import { LarkRuntimeRepository } from './LarkRuntimeRepository'
import type { LarkInboundFact } from './LarkContracts'

type Socket = { close: () => void; send: (value: string) => void; onopen: ((event: unknown) => void) | null; onclose: ((event: unknown) => void) | null; onerror: ((event: unknown) => void) | null; onmessage: ((event: { data: unknown }) => void) | null }
type Factory = new (url: string) => Socket

type VerifiedEnvelope = { facts: LarkInboundFact; acknowledgeWire: string }

/** Generic typed seam for a publicly verified Lark envelope. Composition does not supply an unverified URL or framing. */
export class LarkLongConnectionHost {
  private socket: Socket | null = null
  private readonly closed = new WeakSet<object>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0

  constructor(private readonly deps: { channelId: string; generation: number; socketUrl: string; inbound: ChannelInboundService; runtime: LarkRuntimeRepository; hashEventKey: (key: string) => Promise<string>; parseVerifiedEnvelope: (data: string) => VerifiedEnvelope | null; reconnectSocketUrl: () => Promise<string | null>; createPlatformWebSocket: Factory; isCurrent: () => boolean; signal: AbortSignal; timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout } }) {}

  start(): void {
    this.open(this.deps.socketUrl)
  }
  private open(socketUrl: string): void {
    if (this.deps.signal.aborted || !this.deps.isCurrent()) return
    const socket = new this.deps.createPlatformWebSocket(socketUrl)
    this.socket = socket
    socket.onopen = () => { if (this.current(socket)) this.reconnectAttempt = 0 }
    socket.onmessage = (event) => { void this.handle(event.data, socket) }
    socket.onerror = () => this.audit(socket, 'lark-socket-error')
    socket.onclose = () => {
      this.closed.add(socket)
      if (this.socket !== socket) return
      this.socket = null
      this.scheduleReconnect()
    }
    this.deps.signal.addEventListener('abort', () => this.close(), { once: true })
  }
  close(): void {
    if (this.reconnectTimer) (this.deps.timers?.clearTimeout ?? clearTimeout)(this.reconnectTimer)
    this.reconnectTimer = null
    if (this.socket) this.closed.add(this.socket)
    this.socket?.close()
    this.socket = null
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.deps.signal.aborted || !this.deps.isCurrent()) return
    if (this.reconnectAttempt >= 5) return this.auditClosed('lark-reconnect-exhausted')
    const delay = Math.min(30_000, 1_000 * 2 ** this.reconnectAttempt++)
    this.reconnectTimer = (this.deps.timers?.setTimeout ?? setTimeout)(() => { this.reconnectTimer = null; void this.reconnect() }, delay)
  }
  private async reconnect(): Promise<void> {
    if (this.deps.signal.aborted || !this.deps.isCurrent()) return
    try {
      const url = await this.deps.reconnectSocketUrl()
      if (!url || this.deps.signal.aborted || !this.deps.isCurrent()) return this.scheduleReconnect()
      this.open(url)
    } catch { this.scheduleReconnect() }
  }

  private async handle(data: unknown, source: Socket): Promise<void> {
    if (!this.current(source)) return
    if (typeof data !== 'string' || data.length > 1_000_000) return this.close()
    let envelope: VerifiedEnvelope | null
    try { envelope = this.deps.parseVerifiedEnvelope(data) } catch { this.audit(source, 'lark-envelope-invalid'); return }
    if (!envelope) { this.audit(source, 'lark-event-ignored'); return }
    const fact = envelope.facts
    const result = await this.deps.inbound.receive({
      channelId: this.deps.channelId, generation: this.deps.generation, providerEventKey: fact.eventKey,
      ...(fact.messageKey ? { providerMessageKey: fact.messageKey } : {}), providerConversationKey: fact.conversationKey, providerUserKey: fact.userKey,
      conversationKind: fact.conversationKind, mentionedBot: fact.mentionedBot, ...(fact.text === undefined ? {} : { text: fact.text }), ...(fact.attachments ? { attachments: fact.attachments } : {}),
      acknowledge: async () => {
        const hash = await this.deps.hashEventKey(fact.eventKey)
        if (!this.current(source) || !this.deps.runtime.commitIfCurrent(this.deps.channelId, this.deps.generation, hash) || !this.current(source)) throw new Error('lark-current-gate-failed')
        source.send(envelope.acknowledgeWire)
      }
    })
    if (result.disposition === 'retry') this.audit(source, 'lark-inbound-retry')
  }
  private current(socket: Socket): boolean { return !this.deps.signal.aborted && this.deps.isCurrent() && this.socket === socket && !this.closed.has(socket) }
  private audit(socket: Socket, code: string): void { if (this.current(socket)) this.deps.runtime.auditIfCurrent(this.deps.channelId, this.deps.generation, code) }
  private auditClosed(code: string): void { this.deps.runtime.auditIfCurrent(this.deps.channelId, this.deps.generation, code) }
}
