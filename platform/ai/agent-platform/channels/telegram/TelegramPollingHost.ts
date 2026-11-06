import type { ChannelInboundService } from '../ChannelInboundService'
import type { ChannelInboundResult } from '../ChannelInboundContracts'
import { ChannelConnectionOutage, connectionCauseOfCode, type ChannelConnectionCause } from '../channelConnectionOutage'
import { TelegramOffsetRepository } from './TelegramOffsetRepository'
import { TelegramApiClient, chromiumErrorName, classifyTransportFailure } from './TelegramApiClient'
import { telegramChatId } from './TelegramDeliveryTransport'
import { normalizeTelegramUpdate } from './TelegramUpdateNormalizer'

type Timer = ReturnType<typeof setTimeout>

/** A single sequential getUpdates loop. Offset advances only from the inbound acknowledgement callback. */
export class TelegramPollingHost {
  private controller: AbortController | null = null
  private timer: Timer | null = null
  private stopped = true
  private backoffMs = 1_000
  /** 断线判定：连续失败到阈值才报一次，重试过程一次都不报（`channelConnectionOutage.ts`）。 */
  private readonly outage = new ChannelConnectionOutage()

  constructor(private readonly deps: {
    channelId: string
    generation: number
    inbound: ChannelInboundService
    offsets: TelegramOffsetRepository
    api: TelegramApiClient
    isCurrent: () => boolean
    signal: AbortSignal
    botUsername?: string
    /** 退出回调：`not-current` = 失去资格（代际/启用状态变了），`stopped` = 被明确停掉。 */
    onExit?: (reason: 'not-current' | 'stopped') => void
    /**
     * 自动重连失败（连续失败到阈值）时的通知口子，同一次断开只调一次；恢复不调——
     * 恢复靠状态行与操作记录体现，不另开一条事件（需求 v2.17 §11.5）。
     */
    onConnectionLost?: (input: { cause: ChannelConnectionCause; disconnectedAt: string }) => void
    /** 时钟注入：判定按毫秒时间戳算，测试不该等真实退避。 */
    now?: () => number
    setTimeout?: (callback: () => void, ms: number) => Timer
    clearTimeout?: (timer: Timer) => void
  }) {}

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.schedule(0)
  }

  /** 退出时留一行记录：静默退出是最坏的表现，用户只能干看着没反应。 */
  close(reason: 'not-current' | 'stopped' = 'stopped'): void {
    if (this.stopped) return
    this.stopped = true
    this.deps.onExit?.(reason)
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
    try { await this.poll() } catch (error) {
      if (!this.stopped && !this.deps.signal.aborted && this.deps.isCurrent()) {
        this.deps.offsets.auditIfCurrent(this.deps.channelId, this.deps.generation, 'telegram-poll-failed')
        const cause = transportFailureCause(error)
        if (cause) this.reportConnectionLost(cause)
        this.schedule(this.backoffMs)
        this.backoffMs = Math.min(60_000, this.backoffMs * 2)
      }
    }
  }

  private async poll(): Promise<void> {
    if (this.stopped || this.deps.signal.aborted) return this.close('stopped')
    if (!this.deps.isCurrent()) return this.close('not-current')
    this.controller = new AbortController()
    const signal = AbortSignal.any([this.controller.signal, this.deps.signal])
    const response = await this.deps.api.updates(this.deps.offsets.get(this.deps.channelId), signal)
    this.controller = null
    if (this.stopped || this.deps.signal.aborted) return this.close('stopped')
    if (!this.deps.isCurrent()) return this.close('not-current')
    if (!response.ok) {
      const delay = response.retryAfterMs ?? this.backoffMs
      this.backoffMs = Math.min(60_000, Math.max(1_000, this.backoffMs * 2))
      this.deps.offsets.auditIfCurrent(this.deps.channelId, this.deps.generation, response.code)
      // 限流/进程冲突/token 被拒都不是「连不上」：那种情况报「网络连不上」会把读者带去查错地方。
      const cause = connectionCauseOfCode(response.code)
      if (cause) this.reportConnectionLost(cause)
      this.schedule(delay)
      return
    }
    let retry = false
    for (const update of response.value) {
      if (this.deps.signal.aborted || !this.deps.isCurrent()) return this.close('not-current')
      const fact = normalizeTelegramUpdate(update, this.deps.botUsername)
      if (!fact) {
        // A syntactically unusable update is audited without its body, then only current ownership may skip it.
        this.deps.offsets.auditIfCurrent(this.deps.channelId, this.deps.generation, 'telegram-update-invalid')
        if (!this.deps.offsets.commitIfCurrent(this.deps.channelId, this.deps.generation, update.update_id + 1)) return this.close('not-current')
        continue
      }
      const result = await this.deps.inbound.receive({
        // 没有权限这类「必须回一句」的场景：走同一条通道、同一个会话键。
        reply: async (text: string) => {
          const chatId = telegramChatId(fact.conversationKey)
          if (!chatId) return
          await this.deps.api.sendMessage(chatId, text, true, this.deps.signal)
        },
        channelId: this.deps.channelId,
        generation: this.deps.generation,
        providerEventKey: fact.eventKey,
        providerMessageKey: fact.messageKey,
        providerConversationKey: fact.conversationKey,
        providerUserKey: fact.userKey,
        ...(fact.userLabel ? { providerUserLabel: fact.userLabel } : {}),
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
    // 拿到更新（哪怕一条新的都没有）就是连上了：这次断开到此为止，下次断开是另一件事。
    this.outage.recordSuccess()
    this.schedule(0)
  }

  private reportConnectionLost(cause: ChannelConnectionCause): void {
    const report = this.outage.recordFailure((this.deps.now ?? Date.now)())
    if (!report || !this.deps.onConnectionLost) return
    this.deps.onConnectionLost({ cause, disconnectedAt: new Date(report.disconnectedAt).toISOString() })
  }
}

function isAcknowledged(result: ChannelInboundResult): boolean {
  return result.disposition !== 'retry'
}

/**
 * 只有能认出是**传输层**失败的异常才算「连不上」：入站处理或存储抛出的普通异常不许冒充网络问题，
 * 否则读者收到的是「网络连不上」，真正要修的却是别处。
 */
function transportFailureCause(error: unknown): ChannelConnectionCause | null {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  if (chromiumErrorName(error) === undefined && !/^(TypeError|AbortError|TimeoutError)\b/.test(text)) return null
  return classifyTransportFailure(error) === 'telegram-proxy-unavailable' ? 'proxy' : 'network'
}
