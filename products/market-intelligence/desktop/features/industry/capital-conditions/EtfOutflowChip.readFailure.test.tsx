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
const triggerProps = { 'aria-expanded': false, 'aria-controls': 'detail' } as const

function render(chip: Parameters<typeof EtfOutflowChip>[0]['chip']): string {
  return renderToStaticMarkup(createElement(ShellLanguageProvider, {
    language: 'zh-CN',
    children: createElement(EtfOutflowChip, { chip, text, triggerProps, onToggle: () => undefined, onRetry: () => undefined })
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
    // 内部词不上屏：读者只问「这条分析过没有」，不关心我们的「状态 / 记录 / 通道」。
    expect(markup).not.toMatch(/状态|记录|通道/)
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

  it('never offers a retry: this is not something the reader can do', () => {
    const markup = render({ state: 'unreadable', failureCode: 'invalid-as-of' })
    // 标记仍在（我们确实出错了），但浮层里不许有「重试」。
    expect(markup).toContain('mi-signal-read-issue')
    // 按一百次也不会好的按钮是假按钮，它教读者不再相信真按钮。
    expect(markup).not.toContain('>重试<')
  })
})
