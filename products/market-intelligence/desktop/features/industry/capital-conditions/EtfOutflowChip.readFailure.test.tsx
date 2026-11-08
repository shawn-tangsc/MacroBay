// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'

import { productText } from '../../../shared/i18n/productText'
import { EtfOutflowChip, type EtfSignalText } from './EtfOutflowSignal'

/**
 * 读取失败在牌子上的样子：一句话 + 「能重试才给按钮」。
 *
 * 这一块不测卡片本身，只测牌子这个组件：它决定读者看到的那一句和那个按钮。卡片测试里那份
 * 夹具还有别的历史偏移，混在一起会把这条判据淹掉。
 */
const text = productText['zh-CN'].pages.intelligence.portal.dashboard.capitalConditions as unknown as EtfSignalText
function render(chip: Parameters<typeof EtfOutflowChip>[0]['chip']): string {
  return renderToStaticMarkup(createElement(ShellLanguageProvider, {
    language: 'zh-CN',
    children: createElement(EtfOutflowChip, { chip, text, onRetry: () => undefined, onToggle: () => undefined })
  }))
}

describe('a failed signal read on the ETF chip', () => {
  it('marks the failure with one icon instead of a line of text', () => {
    const markup = render({ state: 'unreadable', failureCode: 'query-failed' })
    expect(markup).toContain('mi-signal-read-issue')
    expect(markup).toContain('有没有被分析过')
    // 正面上没有那行排障话，也没有独立的重试按钮。
    expect(markup).not.toContain('判定记录没拿到')
    expect(markup).not.toContain('重试')
    // 内部词不上屏——只对**那句话**断言，不对整块卡片跑宽泛正则：卡片别处正常出现「记录」
    // 两个字（比如「上次更新记录」）时，宽断言会误红，然后有人为了变绿去删断言。
    const sentence = markup.match(/aria-label="([^"]*没查到[^"]*)"/)?.[1] ?? ''
    expect(sentence).not.toMatch(/状态|记录|通道/)
    // 一处一个。
    expect(markup.split('mi-signal-read-issue').length - 1).toBe(1)
    // 牌子是「有这条信号」的陈述：读不到时一条都不许渲染，连灰牌也不行。
    expect(markup).not.toContain('数据不齐')
    expect(markup).not.toContain('mi-capital-conditions__signal"')
  })

  it('never puts the defect vocabulary on the card', () => {
    const markup = render({ state: 'unreadable', failureCode: 'contract-invalid' })
    // 读者看不懂「格式」「契约」，也做不了任何事；那句话是给我们排障的，不许上屏。
    expect(markup).not.toMatch(/格式|契约|contract|format/i)
    // 不给按钮：这件事不用读者动手，下一次刷新会自己再读。
    expect(markup).not.toContain('重试')
  })
})
