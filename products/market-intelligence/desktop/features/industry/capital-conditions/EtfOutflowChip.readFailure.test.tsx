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
  it('says the record was not available and offers one retry', () => {
    const markup = render({ state: 'unreadable', failureCode: 'query-failed' })
    expect(markup).toContain('判定记录没拿到')
    expect(markup).toContain('重试')
    // 牌子是「有这条信号」的陈述：读不到时一条都不许渲染，连灰牌也不行。
    expect(markup).not.toContain('数据不齐')
    expect(markup).not.toContain('mi-capital-conditions__signal"')
  })

  it('offers no retry where a retry cannot change the answer', () => {
    const markup = render({ state: 'unreadable', failureCode: 'invalid-as-of' })
    expect(markup).toContain('时间不对，读不了')
    // 按一百次也不会好的按钮是假按钮，它教读者不再相信真按钮。
    expect(markup).not.toContain('>重试<')
  })
})
