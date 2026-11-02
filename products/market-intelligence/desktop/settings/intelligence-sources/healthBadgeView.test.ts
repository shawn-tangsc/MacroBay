import { describe, expect, it } from 'vitest'

import { resolveProductTextKey } from '../../shared/i18n/productTextKey'
import { healthBadgeView } from './ProviderDetail'
import { SOURCE_REPEATED_FAILURE_THRESHOLD } from '../../../service/intelligence/application/sourceProjection'

/**
 * 来源健康药丸的四句话与四个 tone。
 *
 * 这一条守的是**词与色的对应**，不是 DOM：`degraded` 一个状态背后两种原因，读者看到的词
 * 必须回答「关注什么」；「已关闭」说的是来源被关掉（服务只在来源停用时报 `paused`），
 * 不是「暂停了一阵子」。
 */
describe('health badge words and tones', () => {
  it('says repeated failures once the shared threshold is reached, and stale data below it', () => {
    const below = healthBadgeView('degraded', SOURCE_REPEATED_FAILURE_THRESHOLD - 1)
    expect(below.tone).toBe('warn')
    expect(below.labelKey).toBe('settings.intelligenceSources.health.statuses.data-stale')

    const at = healthBadgeView('degraded', SOURCE_REPEATED_FAILURE_THRESHOLD)
    expect(at.tone).toBe('bad')
    expect(at.labelKey).toBe('settings.intelligenceSources.health.statuses.multiple-failures')
  })

  it('keeps the other three states on their own word and tone', () => {
    expect(healthBadgeView('healthy', 0)).toEqual({
      labelKey: 'settings.intelligenceSources.health.statuses.healthy',
      tone: 'ok'
    })
    expect(healthBadgeView('failed', 0)).toEqual({
      labelKey: 'settings.intelligenceSources.health.statuses.failed',
      tone: 'bad'
    })
    // `paused` is what the service reports for a disabled source, so it reads "off", never "paused".
    expect(healthBadgeView('paused', 0)).toEqual({
      labelKey: 'settings.intelligenceSources.health.statuses.paused',
      tone: 'muted'
    })
  })

  it('resolves every word in both languages, so no badge falls back to a raw state name', () => {
    const keys = [
      'settings.intelligenceSources.health.statuses.healthy',
      'settings.intelligenceSources.health.statuses.multiple-failures',
      'settings.intelligenceSources.health.statuses.data-stale',
      'settings.intelligenceSources.health.statuses.failed',
      'settings.intelligenceSources.health.statuses.paused'
    ]
    for (const key of keys) {
      expect(resolveProductTextKey('zh-CN', key), key).not.toBe('')
      expect(resolveProductTextKey('en-US', key), key).not.toBe('')
    }
    expect(resolveProductTextKey('zh-CN', 'settings.intelligenceSources.health.statuses.paused')).toBe('已关闭')
    expect(resolveProductTextKey('en-US', 'settings.intelligenceSources.health.statuses.multiple-failures')).toBe('Repeated failures')
  })
})
