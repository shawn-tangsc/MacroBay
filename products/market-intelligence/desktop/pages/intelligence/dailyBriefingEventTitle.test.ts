import { describe, expect, it } from 'vitest'

import { shortenEventTitle } from './dailyBriefingEventTitle'

describe('shortenEventTitle', () => {
  it('rewrites the official Chinese wording into the abbreviation a reader uses', () => {
    expect(shortenEventTitle('制造业采购经理人指数', 'zh-CN')).toBe('制造业 PMI')
    expect(shortenEventTitle('10月非农就业人口变动', 'zh-CN')).toBe('10月非农就业')
    expect(shortenEventTitle('消费者物价指数月率', 'zh-CN')).toBe('CPI月率')
  })

  // The table matches Chinese source wording. An English edition already carries translated
  // titles, so running the Chinese patterns over it could only silently edit the text.
  it('leaves the title alone in the English edition, Chinese wording included', () => {
    expect(shortenEventTitle('Conference Board Consumer Confidence', 'en-US')).toBe('Conference Board Consumer Confidence')
    expect(shortenEventTitle('制造业采购经理人指数', 'en-US')).toBe('制造业采购经理人指数')
  })
})
