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
      confirmed: 'ok',
      'partially-confirmed': 'warn',
      invalidated: 'muted',
      expired: 'muted',
      'insufficient-data': 'warn'
    })
    expect(Object.values(ANALYSIS_STATUS_TONE)).not.toContain('bad')
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
