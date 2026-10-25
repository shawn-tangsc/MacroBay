import type { ChannelInboundService } from '../ChannelInboundService'
import type { QqInboundFact } from './QqContracts'
import { QqRuntimeRepository } from './QqRuntimeRepository'

type Socket = {
  close: () => void
  send: (value: string) => void
  onopen: ((event: unknown) => void) | null
  onclose: ((event: unknown) => void) | null
  onerror: ((event: unknown) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
}
type Factory = new (url: string) => Socket
type VerifiedDispatch = { sequence: number; facts: QqInboundFact; acknowledgeWire: string }

/** Future verified QQ Gateway framing plugs into this source-socket and generation-bound seam. */
export class QqGatewayHost {
  private socket: Socket | null = null
  private closed = new WeakSet<object>()

  constructor(private readonly deps: {
    channelId: string
    generation: number
    gatewayUrl: string
    inbound: ChannelInboundService
    runtime: QqRuntimeRepository
    parseVerifiedDispatch: (data: string) => VerifiedDispatch | null
    createPlatformWebSocket: Factory
    isCurrent: () => boolean
    signal: AbortSignal
  }) {}

  start(): void {
    if (this.deps.signal.aborted || !this.deps.isCurrent()) return
    const socket = new this.deps.createPlatformWebSocket(this.deps.gatewayUrl)
    this.socket = socket
    socket.onmessage = (event) => { void this.handle(event.data, socket) }
    socket.onerror = () => { if (this.current(socket)) this.deps.runtime.auditIfCurrent(this.deps.channelId, this.deps.generation, 'qq-gateway-error') }
    socket.onclose = () => { this.closed.add(socket); if (this.socket === socket) this.socket = null }
    this.deps.signal.addEventListener('abort', () => this.close(), { once: true })
  }

  close(): void {
    if (this.socket) this.closed.add(this.socket)
    this.socket?.close()
    this.socket = null
  }

  private async handle(data: unknown, source: Socket): Promise<void> {
    if (!this.current(source)) return
    if (typeof data !== 'string' || data.length > 1_000_000) return this.close()
    let dispatch: VerifiedDispatch | null
    try { dispatch = this.deps.parseVerifiedDispatch(data) } catch { this.audit(source, 'qq-dispatch-invalid'); return }
    if (!dispatch || !Number.isSafeInteger(dispatch.sequence) || dispatch.sequence < 0) { this.audit(source, 'qq-dispatch-invalid'); return }
    const facts = dispatch.facts
    const result = await this.deps.inbound.receive({
      channelId: this.deps.channelId,
      generation: this.deps.generation,
      providerEventKey: facts.eventKey,
      providerConversationKey: facts.conversationKey,
      providerUserKey: facts.userKey,
      conversationKind: facts.conversationKind,
      mentionedBot: facts.mentionedBot,
      ...(facts.text === undefined ? {} : { text: facts.text }),
      ...(facts.attachments ? { attachments: facts.attachments } : {}),
      acknowledge: async () => {
        if (!this.current(source) || !this.deps.runtime.commitIfCurrent(this.deps.channelId, this.deps.generation, dispatch.sequence) || !this.current(source)) {
          throw new Error('qq-current-gate-failed')
        }
        source.send(dispatch.acknowledgeWire)
      }
    })
    if (result.disposition === 'retry') this.audit(source, 'qq-inbound-retry')
  }

  private current(socket: Socket): boolean {
    return !this.deps.signal.aborted && this.deps.isCurrent() && this.socket === socket && !this.closed.has(socket)
  }

  private audit(socket: Socket, code: string): void {
    if (this.current(socket)) this.deps.runtime.auditIfCurrent(this.deps.channelId, this.deps.generation, code)
  }
}
