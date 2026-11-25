import { describe, expect, it } from 'vitest'

import type { NotificationRecord } from '../contracts/notificationContracts'
import { posterEvidenceOf, type PosterChannelCapability } from './notificationPosterEvidence'

/**
 * 海报这一行（#46）的判据：**记录上是事实，这里只组装**。
 *
 * 四条不许弄反的：
 * - `edition: null`（那一刻表里没有行）与整块缺席（不知道）是两件事；
 * - `N = 0`（一条支持图片的通道都没有）→ 整块不给，界面整行不出现；
 * - 分母只数**这一次推送时启用着**的支持图片通道（`delivery.push.channels` 是那一次的快照），
 *   不支持图片的算进 `unsupportedImageChannelCount`，两者都不许按 `channels` 反推；
 * - `channels` 只含真试过发图的行：`kind:'text'` 的纯导读降级不算发图。
 */
const AT = '2026-11-25T00:30:00.000Z'

function record(patch: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: 'notification-1',
    owner: 'product',
    productId: 'market-intelligence',
    sourceId: 'market-intelligence.briefing.ready',
    eventTypeId: 'market-intelligence.briefing.ready',
    delivery: {},
    channels: ['center'],
    state: 'read',
    severity: 'info',
    priority: 'normal',
    edition: { editionId: '2026-11-25:zh-CN:default', locale: 'zh-CN' },
    actions: [],
    occurrenceCount: 1,
    createdAt: AT,
    updatedAt: AT,
    ...patch
  }
}

const imageChannel = (id: string, name = id.toUpperCase()) => ({ channelId: id, channelName: name, state: 'sent-accepted' as const, at: AT })
const textChannel = (id: string) => ({ channelId: id, channelName: id.toUpperCase(), state: 'sent-accepted' as const, at: AT })

/** 两个通道：`tg` 支持图片，`qq` 不支持。 */
const capability: PosterChannelCapability = (channelId) =>
  channelId === 'tg' ? { channelName: 'Telegram', supportsImage: true } : { channelName: 'QQ', supportsImage: false }

describe('海报行：这一版海报表的状态（冻结在记录上）', () => {
  it('推送那一刻行是 ready：带 href、没有原因档', () => {
    const evidence = posterEvidenceOf(record({
      delivery: {
        push: { state: 'sent-accepted', at: AT, channels: [textChannel('tg')] },
        pushImage: { state: 'sent-accepted', at: AT, channels: [imageChannel('tg')] }
      },
      editionPoster: { contentHash: 'hash-1' },
      editionPosterRow: { status: 'ready', contentHash: 'hash-1', failureCode: null }
    }), capability)!
    expect(evidence.edition).toEqual({ status: 'ready', contentHash: 'hash-1', failureCode: null, reasonKind: null })
  })

  it('行是 failed / timeout：原码留着，但值里只给原因档', () => {
    const failed = posterEvidenceOf(record({
      delivery: { push: { state: 'sent-accepted', at: AT, channels: [textChannel('tg')] } },
      editionPosterRow: { status: 'failed', contentHash: null, failureCode: 'poster-render-failed:blank' }
    }), capability)!
    expect(failed.edition).toEqual({ status: 'failed', contentHash: null, failureCode: 'poster-render-failed:blank', reasonKind: 'render-failed' })
    const timeout = posterEvidenceOf(record({
      delivery: { push: { state: 'sent-accepted', at: AT, channels: [textChannel('tg')] } },
      editionPosterRow: { status: 'timeout', contentHash: null, failureCode: 'poster-render-timeout' }
    }), capability)!
    expect(timeout.edition?.reasonKind).toBe('render-timeout')
    const tooLarge = posterEvidenceOf(record({
      delivery: { push: { state: 'sent-accepted', at: AT, channels: [textChannel('tg')] } },
      editionPosterRow: { status: 'failed', contentHash: null, failureCode: 'poster-too-large' }
    }), capability)!
    expect(tooLarge.edition?.reasonKind).toBe('too-large')
  })

  it('`edition: null`（表里没有行）与整块缺席（不知道）不是一件事', () => {
    const noRow = posterEvidenceOf(record({
      delivery: { push: { state: 'sent-accepted', at: AT, channels: [textChannel('tg')] } },
      editionPosterRow: null
    }), capability)!
    expect(noRow.edition).toBeNull()
    // 老记录：既没有新字段、也没有 hash → 不知道，整行不出现（**不许**编成「这一版没有图」）。
    expect(posterEvidenceOf(record({ delivery: { push: { state: 'sent-accepted', at: AT, channels: [textChannel('tg')] } } }), capability)).toBeUndefined()
    // 新字段上线前、但确实出过图的老记录：只有 ready 才带 hash，所以按 ready 读。
    const legacy = posterEvidenceOf(record({
      delivery: { push: { state: 'sent-accepted', at: AT, channels: [textChannel('tg')] } },
      editionPoster: { contentHash: 'hash-old' }
    }), capability)!
    expect(legacy.edition).toEqual({ status: 'ready', contentHash: 'hash-old', failureCode: null, reasonKind: null })
  })
})

describe('海报行：分母与逐通道结果', () => {
  it('分母是这一次推送时启用着的支持图片通道，不受「有没有被试过」影响', () => {
    const evidence = posterEvidenceOf(record({
      delivery: {
        // 两条通道都启用了；只有 tg 的正文被受理，所以海报只试过 tg。
        push: { state: 'failed', at: AT, channels: [textChannel('tg'), textChannel('qq')] },
        pushImage: { state: 'sent-accepted', at: AT, channels: [imageChannel('tg')] }
      },
      editionPosterRow: { status: 'ready', contentHash: 'hash-1', failureCode: null }
    }), capability)!
    expect(evidence.enabledImageChannelCount).toBe(1)
    expect(evidence.unsupportedImageChannelCount).toBe(1)
    expect(evidence.channels).toHaveLength(1)
  })

  it('一条支持图片的通道都没有：整块不给（没有接收方就没有「发没发」）', () => {
    expect(posterEvidenceOf(record({
      delivery: {
        push: { state: 'sent-accepted', at: AT, channels: [textChannel('qq')] },
        pushImage: { state: 'failed', at: AT, channels: [{ channelId: 'qq', channelName: 'QQ', state: 'failed', reason: 'delivery-image-unsupported', at: AT }] }
      },
      editionPosterRow: { status: 'ready', contentHash: 'hash-1', failureCode: null }
    }), capability)).toBeUndefined()
  })

  it('没有推送对象：`push-unavailable` 不是一次尝试，整块不给', () => {
    expect(posterEvidenceOf(record({ delivery: { push: { state: 'failed', reason: 'push-unavailable', at: AT, channels: [] } } }), capability)).toBeUndefined()
    expect(posterEvidenceOf(record({ delivery: {} }), capability)).toBeUndefined()
  })

  it('逐通道行带能力与原因档；纯导读降级（kind:text）不算发图', () => {
    const evidence = posterEvidenceOf(record({
      delivery: {
        push: { state: 'sent-accepted', at: AT, channels: [textChannel('tg'), textChannel('qq')] },
        pushImage: {
          state: 'failed',
          at: AT,
          channels: [
            imageChannel('tg'),
            { channelId: 'qq', channelName: 'QQ', kind: 'text', state: 'sent-accepted', at: AT }
          ]
        }
      },
      editionPosterRow: { status: 'ready', contentHash: 'hash-1', failureCode: null }
    }), capability)!
    expect(evidence.channels).toHaveLength(1)
    expect(evidence.channels[0]).toMatchObject({ channelId: 'tg', supportsImage: true, state: 'sent-accepted', reasonKind: null })
  })

  it('四个原因档各走各的：拿不到图不能报成「通道未收下」', () => {
    const at = (reason: string) => posterEvidenceOf(record({
      delivery: {
        push: { state: 'sent-accepted', at: AT, channels: [textChannel('tg')] },
        pushImage: { state: 'failed', at: AT, channels: [{ channelId: 'tg', channelName: 'Telegram', state: 'failed', reason, at: AT }] }
      },
      editionPosterRow: { status: 'ready', contentHash: 'hash-1', failureCode: null }
    }), capability)!.channels[0]!
    expect(at('delivery-no-target-bound').reasonKind).toBe('channel-unavailable')
    expect(at('delivery-image-unavailable').reasonKind).toBe('image-unavailable')
    expect(at('delivery-image-source-not-allowed').reasonKind).toBe('image-unavailable')
    expect(at('delivery-image-too-large').reasonKind).toBe('too-large')
    expect(at('channel-rejected').reasonKind).toBe('channel-refused')
    expect(at('delivery-rate-limited').reasonKind).toBe('channel-refused')
  })

  it('失败行缺显示名时从通道注册表补（ⓘ 逐通道一行要用名字，不能印 id）', () => {
    const evidence = posterEvidenceOf(record({
      delivery: {
        push: { state: 'sent-accepted', at: AT, channels: [textChannel('tg')] },
        pushImage: { state: 'failed', at: AT, channels: [{ channelId: 'tg', state: 'failed', reason: 'channel-rejected', at: AT }] }
      },
      editionPosterRow: { status: 'ready', contentHash: 'hash-1', failureCode: null }
    }), capability)!
    expect(evidence.channels[0]?.channelName).toBe('Telegram')
  })

  it('老记录没有 `push.channels` 时，用海报那几行当分母依据，而不是凭空算 0', () => {
    const evidence = posterEvidenceOf(record({
      delivery: { pushImage: { state: 'sent-accepted', at: AT, channels: [imageChannel('tg')] } },
      editionPosterRow: { status: 'ready', contentHash: 'hash-1', failureCode: null }
    }), capability)!
    expect(evidence.enabledImageChannelCount).toBe(1)
  })

  it('没有能力读口（组合根没接）时按「查不到＝不支持」：不把任何通道算进分母 → 整块不给', () => {
    expect(posterEvidenceOf(record({
      delivery: { push: { state: 'sent-accepted', at: AT, channels: [textChannel('tg')] } },
      editionPosterRow: { status: 'ready', contentHash: 'hash-1', failureCode: null }
    }), undefined)).toBeUndefined()
  })

  it('聚合是 failed 也不影响逐通道事实（不许从聚合反推）', () => {
    const evidence = posterEvidenceOf(record({
      delivery: {
        push: { state: 'sent-accepted', at: AT, channels: [textChannel('tg'), textChannel('qq')] },
        pushImage: { state: 'failed', at: AT, channels: [imageChannel('tg')] }
      },
      editionPosterRow: { status: 'ready', contentHash: 'hash-1', failureCode: null }
    }), capability)!
    expect(evidence.channels[0]?.state).toBe('sent-accepted')
  })
})