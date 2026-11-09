// @vitest-environment happy-dom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { resolveStateViewText } from '@platform/ui/components/state/stateViewText'
import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

import { productText } from '../../../shared/i18n/productText'
import { CapitalConditionsPanel } from './CapitalConditionsPanel'
import type { DashboardCapitalConditionsState } from './capitalConditionsModel'

/**
 * 卡片整体读不出来时，读者看到的**动作**必须和原因对得上。
 *
 * 旧形状只有一个 `{ state: 'unavailable' }`，5 种失败都画成「读取失败 + 重试」；其中「形状/版本不符」
 * 点一百次也不会好——给一个必然再失败的按钮，比没有按钮更坏。下面两条钉住这条界线。
 */
const text = productText['zh-CN'].pages.intelligence.portal.dashboard.capitalConditions
const retryLabel = resolveStateViewText('zh-CN', 'ui.state.action.retry')
const restartLabel = resolveStateViewText('zh-CN', 'ui.state.action.restart-app')

function render(state: DashboardCapitalConditionsState): string {
  return renderToStaticMarkup(createElement(ShellLanguageProvider, {
    language: 'zh-CN',
    children: createElement(ShellTimeZoneProvider, {
      timeZone: 'UTC',
      children: createElement(CapitalConditionsPanel, { text, state, onRefresh: () => undefined })
    })
  }))
}

describe('a capital-conditions card that could not read', () => {
  it('does not offer a retry for a version/shape mismatch, and says what the reader can actually do', () => {
    const markup = render({ state: 'unavailable', reason: 'contract-mismatch' })

    // 该做的是完全退出后重开——这句话必须在场，否则读者只剩一个不能点的错误块。
    expect(markup).toContain(text.contractMismatch)
    expect(text.contractMismatch).toContain('完全退出')
    // 点了必然再失败的重试不许出现。
    expect(markup).not.toContain(retryLabel)
    // 唯一的出口是重启应用，所以给的是那颗真按钮，不是重试。
    expect(markup).toContain(restartLabel)
  })

  it('offers the retry when the read itself failed', () => {
    const markup = render({ state: 'unavailable', reason: 'query-failed' })

    expect(markup).toContain(retryLabel)
    // 读失败不是版本问题，别把重开应用的话塞给他。
    expect(markup).not.toContain(text.contractMismatch)
  })
})
