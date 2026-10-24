import type { ChannelInboundService } from '../ChannelInboundService'
import type { ChannelInboundResult } from '../ChannelInboundContracts'
import { TelegramOffsetRepository } from './TelegramOffsetRepository'
import { TelegramApiClient } from './TelegramApiClient'
import { normalizeTelegramUpdate } from './TelegramUpdateNormalizer'

type Timer = ReturnType<typeof setTimeout>

/** A single sequential getUpdates loop. Offset advances only from the inbound acknowledgement callback. */
export class TelegramPollingHost {
  private controller: AbortController | null = null
  private timer: Timer | null = null
  private stopped = true
  private backoffMs = 1_000

  constructor(private readonly deps: {
    channelId: string
    generation: number
    inbound: ChannelInboundService
    offsets: TelegramOffsetRepository
    api: TelegramApiClient
    isCurrent: () => boolean
    signal: AbortSignal
    botUsername?: string
    setTimeout?: (callback: () => void, ms: number) => Timer
    clearTimeout?: (timer: Timer) => void
  }) {}

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.schedule(0)
  }

  close(): void {
    this.stopped = true
    this.controller?.abort()
    this.controller = null
    if (this.timer) (this.deps.clearTimeout ?? clearTimeout)(this.timer)
    this.timer = null
  }

  private schedule(delay: number): void {
    if (this.stopped) return
    this.timer = (this.deps.setTimeout ?? setTimeout)(() => { void this.pollSafely() }, delay)
  }

  private async pollSafely(): Promise<void> {
    try { await this.poll() } catch {
      if (!this.stopped && !this.deps.signal.aborted && this.deps.isCurrent()) {
        this.deps.offsets.auditIfCurrent(this.deps.channelId, this.deps.generation, 'telegram-poll-failed')
        this.schedule(this.backoffMs)
        this.backoffMs = Math.min(60_000, this.backoffMs * 2)
      }
    }
  }

  private async poll(): Promise<void> {
    if (this.stopped || this.deps.signal.aborted || !this.deps.isCurrent()) return this.close()
    this.controller = new AbortController()
    const signal = AbortSignal.any([this.controller.signal, this.deps.signal])
    const response = await this.deps.api.updates(this.deps.offsets.get(this.deps.channelId), signal)
    this.controller = null
    if (this.stopped || this.deps.signal.aborted || !this.deps.isCurrent()) return this.close()
    if (!response.ok) {
      const delay = response.retryAfterMs ?? this.backoffMs
      this.backoffMs = Math.min(60_000, Math.max(1_000, this.backoffMs * 2))
      this.deps.offsets.auditIfCurrent(this.deps.channelId, this.deps.generation, response.code)
      this.schedule(delay)
      return
    }
    let retry = false
    for (const update of response.value) {
      if (this.deps.signal.aborted || !this.deps.isCurrent()) return this.close()
      const fact = normalizeTelegramUpdate(update, this.deps.botUsername)
      if (!fact) {
        // A syntactically unusable update is audited without its body, then only current ownership may skip it.
        this.deps.offsets.auditIfCurrent(this.deps.channelId, this.deps.generation, 'telegram-update-invalid')
        if (!this.deps.offsets.commitIfCurrent(this.deps.channelId, this.deps.generation, update.update_id + 1)) return this.close()
        continue
      }
      const result = await this.deps.inbound.receive({
        channelId: this.deps.channelId,
        generation: this.deps.generation,
        providerEventKey: fact.eventKey,
        providerMessageKey: fact.messageKey,
        providerConversationKey: fact.conversationKey,
        providerUserKey: fact.userKey,
        conversationKind: fact.conversationKind,
        mentionedBot: fact.mentionedBot,
        ...(fact.text === undefined ? {} : { text: fact.text }),
        ...(fact.attachments ? { attachments: fact.attachments } : {}),
        acknowledge: async () => {
          if (this.deps.signal.aborted || !this.deps.offsets.commitIfCurrent(this.deps.channelId, this.deps.generation, update.update_id + 1)) {
            throw new Error('telegram-offset-commit-failed')
          }
        }
      })
      if (!isAcknowledged(result)) { retry = true; break }
    }
    if (retry) {
      const delay = this.backoffMs
      this.backoffMs = Math.min(60_000, this.backoffMs * 2)
      this.schedule(delay)
      return
    }
    this.backoffMs = 1_000
    this.schedule(0)
  }
}

function isAcknowledged(result: ChannelInboundResult): boolean {
  return result.disposition !== 'retry'
}
