import { describe, expect, it } from 'vitest'

import {
  calendarInterpretationDataKey, calendarInterpretationTier, interpretationAllowedNumbers,
  interpretationCitesOnlyEnvelopeNumbers, interpretationTextFits
} from './calendarEventInterpretationPolicy'
import { buildCalendarInterpretationEnvelope } from './calendarEventInterpretationEnvelope'

/**
 * 解读的判据（R36 #34 第二半）：档门控、数据指纹、事实校验。
 *
 * 最重要的一条是**低档与未分级不生成**——产品定的预算是按档花的，低档也生成等于拿读者的钱
 * 买一段没人要的解读。第二条是「同一份数据只生成一次」：指纹只认展示串，源改了格式也算变了。
 */
const facts = {
  eventKey: 'US.CPI.RELEASE.2026-M10', title: '美国 10 月 CPI 年率', country: 'US', importance: 'high' as const,
  periodKey: '2026-M10', scheduledDate: '2026-11-13', scheduledAt: '2026-11-13T13:30:00.000Z',
  actual: '3.2%', previous: '3.0%', consensus: '3.1%', source: 'BLS'
}
const frozen = buildCalendarInterpretationEnvelope({ event: facts, history: [{ periodKey: '2026-M09', actual: '3.0%', previous: '2.9%' }] })

describe('calendarEventInterpretation: 档门控与指纹', () => {
  it('高档自动、中档点开、低档与未分级不生成', () => {
    expect(calendarInterpretationTier('high')).toBe('auto')
    expect(calendarInterpretationTier('medium')).toBe('on-open')
    expect(calendarInterpretationTier('low')).toBe('never')
    // 未分级是「我们还没判」，不是低——但两者都不花这笔钱。
    expect(calendarInterpretationTier(undefined)).toBe('never')
  })

  it('指纹只认展示串：同一组数同指纹，任何一项变化（含格式）都换指纹', () => {
    const base = { actual: '3.2%', consensus: '3.1%', previous: '3.0%' }
    expect(calendarInterpretationDataKey(base)).toBe(calendarInterpretationDataKey({ ...base }))
    expect(calendarInterpretationDataKey(base)).not.toBe(calendarInterpretationDataKey({ ...base, actual: '3.3%' }))
    expect(calendarInterpretationDataKey(base)).not.toBe(calendarInterpretationDataKey({ ...base, consensus: '' }))
    // 源把 3.20% 改写回 3.2%：数值相同，但不是同一份展示串，必须重写解读。
    expect(calendarInterpretationDataKey(base)).not.toBe(calendarInterpretationDataKey({ ...base, actual: '3.20%' }))
  })
})

describe('calendarEventInterpretation: 只查事实，不查句式', () => {
  it('引用信封里的数字可以，自己算一个出来就是 fact-mismatch', () => {
    expect(interpretationCitesOnlyEnvelopeNumbers('美国 10 月 CPI 年率 3.2%，高于预期的 3.1%。', frozen.envelope)).toBe(true)
    expect(interpretationCitesOnlyEnvelopeNumbers('CPI 年率 3.2%，比预期高 0.1 个百分点。', frozen.envelope)).toBe(false)
    expect(interpretationCitesOnlyEnvelopeNumbers('折年率 4.4%。', frozen.envelope)).toBe(false)
  })

  it('允许集来自信封里的值、期次与标题，不是一张词表', () => {
    const allowed = interpretationAllowedNumbers(frozen.envelope)
    expect(allowed.has('3.2')).toBe(true)
    expect(allowed.has('2026')).toBe(true) // 期次里的年份是事实
    expect(allowed.has('10')).toBe(true) // 标题「10 月」是事实
    expect(allowed.has('4.4')).toBe(false)
  })

  it('太短等于没写，太长是复述快照', () => {
    expect(interpretationTextFits('太短')).toBe(false)
    expect(interpretationTextFits('美国 10 月 CPI 年率 3.2%，高于预期，说明通胀仍有粘性。')).toBe(true)
    expect(interpretationTextFits('字'.repeat(601))).toBe(false)
  })
})