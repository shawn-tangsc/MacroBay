import { describe, expect, it } from 'vitest'

import { resolveProductTextKey } from '../../shared/i18n/productTextKey'
import { ANALYSIS_STATUS_KEY, ANALYSIS_STATUS_TONE } from './analysisStatusPresentation'

describe('analysis status presentation', () => {
  it('maps every status to one tone, and never uses bad for a conclusion that simply ended', () => {
    // 这一格是界面设计定的口径（Chief 采纳）：红色只表示「出错／读取失败」。
    // 「已替代 / 已到期 / 已失效」都是已经结束、不需要动作的状态，走 muted。
    expect(ANALYSIS_STATUS_TONE).toEqual({
      published: 'ok',
      stale: 'warn',
      superseded: 'muted',
      pending: 'info',
      running: 'info',
      failed: 'bad',
      confirmed: 'ok',
      'partially-confirmed': 'warn',
      invalidated: 'muted',
      expired: 'muted',
      'insufficient-data': 'warn'
    })
    // 已经结束的结论档不许升成红：标红会让真正的错误不再显眼。
    for (const ended of ['superseded', 'invalidated', 'expired'] as const) expect(ANALYSIS_STATUS_TONE[ended]).toBe('muted')
    // 唯一的红是「这一次运行没跑成」——应用没把这件事做完，不是「一个已经结束的判断」。
    expect(Object.entries(ANALYSIS_STATUS_TONE).filter(([, tone]) => tone === 'bad')).toEqual([['failed', 'bad']])
  })

  it('points every status at a sentence that exists in both languages', () => {
    // 键写错会安静地渲染成空药丸；这里按两种语言各解析一次，缺一句就红。
    for (const key of Object.values(ANALYSIS_STATUS_KEY)) {
      expect(resolveProductTextKey('zh-CN', key), key).not.toBe('')
      expect(resolveProductTextKey('en-US', key), key).not.toBe('')
    }
    // 两张表覆盖同一个闭集：多一个、少一个都不行。
    expect(Object.keys(ANALYSIS_STATUS_KEY).sort()).toEqual(Object.keys(ANALYSIS_STATUS_TONE).sort())
  })
})
