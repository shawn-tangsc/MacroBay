import { describe, expect, it } from 'vitest'

import type { BriefingGenerationProgress } from '../../../contracts/dailyBriefing'
import { liveProgressFor } from './dailyBriefingProgressReader'

/**
 * 并行时不许显示错那一次：进度先按**这一次跑的期号**精确取，取不到才退回 (日期, 语言) 的最近一条。
 * 同一天同一语言可以并行（定时期超时后与下一期、或手动期自带一次性期号），这是那条已知限制的收口。
 */
const progress = (label: string): BriefingGenerationProgress => ({ stage: label } as unknown as BriefingGenerationProgress)

const journal = (): Map<string, BriefingGenerationProgress> => new Map([
  ['2026-11-05:default:zh-CN', progress('scheduled-07')],
  ['2026-11-05:period_manual:zh-CN', progress('manual')]
])

describe('progress is looked up by the run that was started', () => {
  it('returns the run named by its own period id, not the latest of the same day', () => {
    const rows = journal()
    expect(liveProgressFor(rows, '2026-11-05', 'zh-CN', 'default')).toBe(rows.get('2026-11-05:default:zh-CN'))
    expect(liveProgressFor(rows, '2026-11-05', 'zh-CN', 'period_manual')).toBe(rows.get('2026-11-05:period_manual:zh-CN'))
  })

  it('falls back to the latest of that day only when the caller has no period id', () => {
    const rows = journal()
    // 调用方没给期号时退回最近一条；这是兜底路径，不是默认路径。
    expect(liveProgressFor(rows, '2026-11-05', 'zh-CN')).toBe(rows.get('2026-11-05:period_manual:zh-CN'))
  })

  it('returns nothing for a period id that is not running', () => {
    expect(liveProgressFor(journal(), '2026-11-05', 'zh-CN', 'period_elsewhere')).toBeUndefined()
  })
})
