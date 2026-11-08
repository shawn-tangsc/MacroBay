import { describe, expect, it } from 'vitest'

import { productText } from '../../../shared/i18n/productText'
import { blsUnavailableSentence, readBlsUnavailable } from './blsAvailability'

const text = productText['zh-CN'].pages.intelligence.portal.calendar

const registryEntry = {
  sourceId: 'macro-calendar-bls',
  unavailable: { reasonCode: 'official-endpoint-returned-403', lastSuccessfulSyncAt: '2026-10-22T07:29:41.000Z' }
}

describe('the stopped BLS calendar, read from one place', () => {
  it('reads the reason code and the last successful date from the registry entry, not from copy', () => {
    expect(readBlsUnavailable([registryEntry])).toEqual({ reasonCode: 'official-endpoint-returned-403', lastSuccessDate: '2026-10-22' })
    // 别的来源、或没有这一项时，什么都不产出——不凭「没有 BLS」编一个停用。
    expect(readBlsUnavailable([{ sourceId: 'fear-greed' }])).toBeUndefined()
    expect(readBlsUnavailable(undefined)).toBeUndefined()
  })

  it('builds the architect’s sentence verbatim, with the date handed in rather than typed again', () => {
    const sentence = blsUnavailableSentence(text, readBlsUnavailable([registryEntry]))
    expect(sentence).toBe('BLS 官方日历：当前网络环境无法自动获取（官方站点返回 403），自动同步已停止；库里的 BLS 事件来自上次成功同步（2026-10-22），发布时间未知。')
    // 三种说法一个都不许出现：那是「确实没有」「一次尝试失败」「已启用」。
    expect(sentence).not.toContain('暂无数据')
    expect(sentence).not.toContain('没有数据')
    expect(sentence).not.toContain('同步失败')
  })

  it('says nothing for a different reason code instead of reusing this sentence', () => {
    // 403 与别的原因不是同一件事：别的码要产品另给一句，这里不硬套。
    expect(blsUnavailableSentence(text, { reasonCode: 'something-else' })).toBeUndefined()
  })
})
