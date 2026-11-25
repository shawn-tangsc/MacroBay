import { describe, expect, it } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { staleReasonLines, type StaleReasonSource } from './staleReasonLines'

/**
 * 「这个源还产出吗」两句文案（用户 2026-11-21 要的可见面）。判据四条：
 *
 * 1. 两种病同时为真 → **两条都显示**，不挑一个、不合并成一句；
 * 2. 句子里的数字来自 `staleMeasurements`，界面不自己算；
 * 3. 原因有、数字没有 → 落既有的「状态暂时读不到」，**不显示半句**、不编数字；
 * 4. 没有原因 → 空数组（不额外画一句「正常」，那会把「没报病」说成「健康」）。
 */
const text = productText['zh-CN'].settings.intelligenceSources
const en = productText['en-US'].settings.intelligenceSources

function resolverOf(table: Readonly<Record<string, unknown>>): (key: string) => string {
  return (key: string) => key
    .replace('settings.intelligenceSources.', '')
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], table) as string
}

const resolveText = resolverOf(text)

function lines(source: StaleReasonSource): string[] {
  return staleReasonLines(source, resolveText)
}

describe('采集产出状态的两句话', () => {
  it('两种病同时为真：两条都显示，各带自己的数字', () => {
    expect(lines({ staleReasons: ['no-output', 'normalize-failing'], staleMeasurements: { noOutputHours: 30, normalizeFailureStreak: 3 } }))
      .toEqual([
        text.staleReason['no-output'].replace('{hours}', '30'),
        text.staleReason['normalize-failing'].replace('{count}', '3')
      ])
  })

  it('只有一种病时只出一句，不拿另一句凑数', () => {
    expect(lines({ staleReasons: ['no-output'], staleMeasurements: { noOutputHours: 47 } }))
      .toEqual([text.staleReason['no-output'].replace('{hours}', '47')])
    expect(lines({ staleReasons: ['normalize-failing'], staleMeasurements: { normalizeFailureStreak: 5 } }))
      .toEqual([text.staleReason['normalize-failing'].replace('{count}', '5')])
  })

  it('原因在、数字不在：落「状态暂时读不到」，不显示半句、不编数', () => {
    const only = lines({ staleReasons: ['no-output'] })
    expect(only).toEqual([text.health.unknown])
    expect(only.join('')).not.toContain('{hours}')
    // 两句都没有数字时也只说一次「读不到」，不说两遍。
    expect(lines({ staleReasons: ['no-output', 'normalize-failing'] })).toEqual([text.health.unknown])
  })

  it('只有第二条缺数字时，「读不到」落在第二条的位置，不追到末尾', () => {
    // 追到末尾会让读者把这句读成第一条的状态（界面设计 2026-11-21）。
    expect(lines({ staleReasons: ['no-output', 'normalize-failing'], staleMeasurements: { noOutputHours: 30 } }))
      .toEqual([text.staleReason['no-output'].replace('{hours}', '30'), text.health.unknown])
    // 反过来（第一条缺、第二条有）也一样：位置就是原因的位置。
    expect(lines({ staleReasons: ['no-output', 'normalize-failing'], staleMeasurements: { normalizeFailureStreak: 3 } }))
      .toEqual([text.health.unknown, text.staleReason['normalize-failing'].replace('{count}', '3')])
  })

  it('没有原因就是空数组——不评价「健康」', () => {
    expect(lines({})).toEqual([])
    expect(lines({ staleReasons: [] })).toEqual([])
  })

  it('英文侧同样两句话、同样插值（文案成对，不是只有中文能用）', () => {
    const enLines = staleReasonLines(
      { staleReasons: ['no-output', 'normalize-failing'], staleMeasurements: { noOutputHours: 30, normalizeFailureStreak: 3 } },
      resolverOf(en)
    )
    expect(enLines).toEqual([
      en.staleReason['no-output'].replace('{hours}', '30'),
      en.staleReason['normalize-failing'].replace('{count}', '3')
    ])
  })
})