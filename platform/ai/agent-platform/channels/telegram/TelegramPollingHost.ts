import type { ChannelInboundService } from '../ChannelInboundService'
import type { ChannelInboundResult } from '../ChannelInboundContracts'
import { ChannelConnectionOutage, connectionCauseOfCode, type ChannelConnectionCause } from '../channelConnectionOutage'
import { TelegramOffsetRepository } from './TelegramOffsetRepository'
import { TelegramApiClient, chromiumErrorName, classifyTransportFailure } from './TelegramApiClient'
import { telegramChatId } from './TelegramDeliveryTransport'
import { normalizeTelegramUpdate } from './TelegramUpdateNormalizer'

type Timer = ReturnType<typeof setTimeout>

/**
 * 自动重连的节奏与上限（读者能看见的三态：重试中 / 已恢复 / 已放弃）。
 *
 * 为什么要有「已放弃」：以前失败只写一行审计然后无限重试，`channel_runtime_audits` 一空白就分不出
 * 「恢复了」还是「停了」——读者那边的感受就是「收不到消息，也没人告诉我为什么」（2026-11-08 现场）。
 */
export const telegramPollRecoveryPolicy: Readonly<{
  maximumConsecutiveFailures: number
  baseDelayMs: number
  maximumDelayMs: number
}> = Object.freeze({
  /** 连续失败到这个数就停：按 1→2→4→…→60s 退避算，约 15 分钟没有一次成功。 */
  maximumConsecutiveFailures: 20,
  baseDelayMs: 1_000,
  maximumDelayMs: 60_000
})

export type TelegramPollingState = 'idle' | 'polling' | 'retrying' | 'recovered' | 'abandoned'
export type TelegramPollingStatus = Readonly<{ state: TelegramPollingState; consecutiveFailures: number }>

/** A single sequential getUpdates loop. Offset advances only from the inbound acknowledgement callback. */
export class TelegramPollingHost {
  private controller: AbortController | null = null
  private timer: Timer | null = null
  private stopped = true
  private backoffMs = telegramPollRecoveryPolicy.baseDelayMs
  /** 读者可见的三态 + 连续失败计数：审计表只说「发生过什么」，这里说「现在是哪一种」。 */
  private state: TelegramPollingState = 'idle'
  private consecutiveFailures = 0
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
    this.state = 'polling'
    this.consecutiveFailures = 0
    this.schedule(0)
  }

  /** 当前状态：`retrying` / `recovered` / `abandoned` 三档必须在读的时候分得开。 */
  status(): TelegramPollingStatus {
    return Object.freeze({ state: this.state, consecutiveFailures: this.consecutiveFailures })
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
      if (this.stopped || this.deps.signal.aborted || !this.deps.isCurrent()) return
      // **不再每次尝试写一行**（2026-11-10 用户报「整屏被同一种红行刷满」）：重试期间只由
      // `failAndReschedule` 在状态变化时写一行；具体成因留在断线通知（`onConnectionLost`）里。
      const cause = transportFailureCause(error)
      if (cause) this.reportConnectionLost(cause)
      this.failAndReschedule()
    }
  }

  /**
   * 一次失败之后：记状态、到上限就**停下并写明**，否则按退避重排。
   *
   * 「正在重试」这个码每次断开只写一行（第一次失败时），不是每次重试一行：重试可能持续 15 分钟、
   * 十几行同义记录会把 500 行的面板预算吃光，真正该看的那条反而被挤掉。
   */
  private failAndReschedule(): void {
    this.consecutiveFailures += 1
    if (this.consecutiveFailures === 1) {
      this.deps.offsets.auditIfCurrent(this.deps.channelId, this.deps.generation, 'telegram-poll-retrying')
    }
    if (this.consecutiveFailures >= telegramPollRecoveryPolicy.maximumConsecutiveFailures) {
      // 到上限：停在「已放弃」，不再排下一次——但**不静默**，审计与 `status()` 都说得清。
      this.state = 'abandoned'
      this.deps.offsets.auditIfCurrent(this.deps.channelId, this.deps.generation, 'telegram-poll-abandoned')
      return
    }
    this.state = 'retrying'
    this.schedule(this.backoffMs)
    this.backoffMs = Math.min(telegramPollRecoveryPolicy.maximumDelayMs, this.backoffMs * 2)
  }

  /** 成功一次就恢复：只有「这一次断开确实在重试」时才写恢复行，正常轮询不刷记录。 */
  private noteSuccess(): void {
    if (this.state === 'retrying') {
      this.deps.offsets.auditIfCurrent(this.deps.channelId, this.deps.generation, 'telegram-poll-recovered')
      this.state = 'recovered'
    } else if (this.state === 'abandoned') {
      // 被外部重新拉起后成功：同样是恢复。
      this.deps.offsets.auditIfCurrent(this.deps.channelId, this.deps.generation, 'telegram-poll-recovered')
      this.state = 'recovered'
    }
    this.consecutiveFailures = 0
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
      // 同上：这里也不逐条写失败码（一次断线可能重试几十次）；状态行由 `failAndReschedule` 写。
      // 成因仍然交给断线通知，别把「网络连不上」写在限流/冲突上。
      // 限流/进程冲突/token 被拒都不是「连不上」：那种情况报「网络连不上」会把读者带去查错地方。
      const cause = connectionCauseOfCode(response.code)
      if (cause) this.reportConnectionLost(cause)
      if (response.retryAfterMs !== undefined) this.backoffMs = Math.min(telegramPollRecoveryPolicy.maximumDelayMs, response.retryAfterMs)
      this.failAndReschedule()
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
    this.backoffMs = telegramPollRecoveryPolicy.baseDelayMs
    // 拿到更新（哪怕一条新的都没有）就是连上了：这次断开到此为止，下次断开是另一件事。
    this.outage.recordSuccess()
    this.noteSuccess()
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
