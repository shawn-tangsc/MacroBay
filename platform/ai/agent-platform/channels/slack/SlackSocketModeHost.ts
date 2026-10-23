import type { ChannelInboundService } from '../ChannelInboundService'
import { normalizeSlackEnvelope } from './SlackUpdateNormalizer'
import { SlackRuntimeRepository } from './SlackRuntimeRepository'
import type { SlackSocketEnvelope } from './SlackContracts'

type PlatformWebSocket = { close: () => void; send: (value: string) => void; onopen: ((event: unknown) => void) | null; onclose: ((event: unknown) => void) | null; onerror: ((event: unknown) => void) | null; onmessage: ((event: { data: unknown }) => void) | null }
type WebSocketFactory = new (url: string) => PlatformWebSocket

/** Socket Mode acknowledges only after C03 receipt/work durability and a current-generation gate. */
export class SlackSocketModeHost {
  private socket: PlatformWebSocket | null = null
  private readonly closedSockets = new WeakSet<object>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0

  constructor(private readonly deps: {
    channelId: string; generation: number; socketUrl: string; botUserId: string; inbound: ChannelInboundService
    runtime: SlackRuntimeRepository; hashEventKey: (eventKey: string) => Promise<string>
    createPlatformWebSocket: WebSocketFactory; isCurrent: () => boolean; signal: AbortSignal
    reconnectSocketUrl: () => Promise<string | null>
    timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout }
  }) {}

  start(): void {
    this.open(this.deps.socketUrl)
  }

  close(): void {
    if (this.reconnectTimer) (this.deps.timers?.clearTimeout ?? clearTimeout)(this.reconnectTimer)
    this.reconnectTimer = null
    if (this.socket) this.closedSockets.add(this.socket)
    this.socket?.close()
    this.socket = null
  }

  private open(socketUrl: string): void {
    if (this.deps.signal.aborted || !this.deps.isCurrent()) return
    const socket = new this.deps.createPlatformWebSocket(socketUrl)
    this.closedSockets.delete(socket)
    this.socket = socket
    socket.onopen = () => {
      if (!this.isCurrentSocket(socket)) return
      // A successful REST URL fetch is not a connection success. Only open resets retry budget.
      this.reconnectAttempt = 0
    }
    socket.onmessage = (event) => { void this.handle(event.data, socket) }
    socket.onerror = () => this.auditCurrent(socket, 'slack-socket-error')
    socket.onclose = () => {
      // A late close from a replaced socket must not schedule a second host.
      this.closedSockets.add(socket)
      if (this.socket !== socket) return
      this.socket = null
      this.deps.runtime.auditIfCurrent(this.deps.channelId, this.deps.generation, 'slack-socket-closed')
      this.scheduleReconnect()
    }
    this.deps.signal.addEventListener('abort', () => this.close(), { once: true })
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.deps.signal.aborted || !this.deps.isCurrent()) return
    if (this.reconnectAttempt >= 5) {
      this.deps.runtime.auditIfCurrent(this.deps.channelId, this.deps.generation, 'slack-reconnect-exhausted')
      return
    }
    const delay = Math.min(30_000, 1_000 * 2 ** this.reconnectAttempt++)
    this.reconnectTimer = (this.deps.timers?.setTimeout ?? setTimeout)(() => {
      this.reconnectTimer = null
      void this.reconnect()
    }, delay)
  }

  private async reconnect(): Promise<void> {
    if (this.deps.signal.aborted || !this.deps.isCurrent()) return
    try {
      const socketUrl = await this.deps.reconnectSocketUrl()
      if (!socketUrl || this.deps.signal.aborted || !this.deps.isCurrent()) return this.scheduleReconnect()
      this.open(socketUrl)
    } catch {
      this.scheduleReconnect()
    }
  }

  private async handle(data: unknown, sourceSocket: PlatformWebSocket): Promise<void> {
    if (!this.isCurrentSocket(sourceSocket) || typeof data !== 'string' || data.length > 1_000_000) return this.close()
    let envelope: SlackSocketEnvelope
    try { envelope = JSON.parse(data) as SlackSocketEnvelope } catch { this.auditCurrent(sourceSocket, 'slack-envelope-invalid'); return }
    const envelopeId = typeof envelope.envelope_id === 'string' && envelope.envelope_id.length <= 512 ? envelope.envelope_id : null
    const fact = normalizeSlackEnvelope(envelope, this.deps.botUserId)
    if (!fact || !envelopeId) { this.auditCurrent(sourceSocket, 'slack-event-ignored'); return }
    const result = await this.deps.inbound.receive({
      channelId: this.deps.channelId, generation: this.deps.generation, providerEventKey: fact.eventKey,
      ...(fact.messageKey ? { providerMessageKey: fact.messageKey } : {}), providerConversationKey: fact.conversationKey,
      providerUserKey: fact.userKey, conversationKind: fact.conversationKind, mentionedBot: fact.mentionedBot,
      ...(fact.text === undefined ? {} : { text: fact.text }), ...(fact.attachments ? { attachments: fact.attachments } : {}),
      acknowledge: async () => {
        const eventHash = await this.deps.hashEventKey(fact.eventKey)
        // Never commit or acknowledge an envelope over a newer/replaced socket.
        if (!this.isCurrentSocket(sourceSocket)) {
          throw new Error('slack-current-gate-failed')
        }
        if (!this.deps.runtime.commitIfCurrent(this.deps.channelId, this.deps.generation, eventHash, null) || !this.isCurrentSocket(sourceSocket)) {
          throw new Error('slack-current-gate-failed')
        }
        sourceSocket.send(JSON.stringify({ envelope_id: envelopeId }))
      }
    })
    if (result.disposition === 'retry') this.auditCurrent(sourceSocket, 'slack-inbound-retry')
  }

  private isCurrentSocket(socket: PlatformWebSocket): boolean {
    return !this.deps.signal.aborted && this.deps.isCurrent() && this.socket === socket && !this.closedSockets.has(socket)
  }

  private auditCurrent(socket: PlatformWebSocket, code: string): void {
    if (this.isCurrentSocket(socket)) this.deps.runtime.auditIfCurrent(this.deps.channelId, this.deps.generation, code)
  }
}
