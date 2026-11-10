// @vitest-environment happy-dom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

import { productText } from '../../../shared/i18n/productText'
import { CapitalConditionsPanel, type DashboardSourceAvailability } from './CapitalConditionsPanel'
import type { DashboardCapitalConditionsState } from './capitalConditionsModel'

/**
 * 看板「没配置 / 没启用 / 读不到」三态（规范 `2026-11-11-source-availability-styles.md`）。
 *
 * 四条判据各一条：三句互不相同；没启用不许说成「没有」；读不到不许画成正常或空态；
 * 任何一态都不许退化成空态（`data-state="empty"` / 平台 `state-view` 都不许出现）。
 * 顺序也钉住：宿主给了 `sourceAvailability` 时**先判它**，不看读数——没配置的源谈不上「读不到」。
 */
const zh = productText['zh-CN']
const text = zh.pages.intelligence.portal.dashboard.capitalConditions
const data = zh.pages.intelligence.portal.data

function render(props: Readonly<{
  state?: DashboardCapitalConditionsState
  availability?: DashboardSourceAvailability
  onOpenSources?: () => void
}>): string {
  return renderToStaticMarkup(createElement(ShellLanguageProvider, {
    language: 'zh-CN',
    children: createElement(ShellTimeZoneProvider, {
      timeZone: 'UTC',
      children: createElement(CapitalConditionsPanel, {
        text,
        state: props.state ?? { state: 'unavailable', reason: 'query-failed' },
        onRefresh: () => undefined,
        ...(props.availability ? { sourceAvailability: props.availability } : {}),
        ...(props.onOpenSources ? { onOpenSources: props.onOpenSources } : {})
      })
    })
  }))
}

const missing = render({ availability: { state: 'missing' }, onOpenSources: () => undefined })
const disabled = render({ availability: { state: 'disabled', sourceLabel: text.btc }, onOpenSources: () => undefined })
const unreadable = render({})

describe('the three source states', () => {
  it('says three different things for the three different causes', () => {
    expect(missing).toContain(data.sourcesNotConfigured)
    expect(disabled).toContain(data.sourcesNotEnabled)
    expect(unreadable).toContain(data.temporarilyUnavailable)
    // 三句两两不同：任何两句相同就说明有一态被另一态冒充了。
    expect(new Set([data.sourcesNotConfigured, data.sourcesNotEnabled, data.temporarilyUnavailable]).size).toBe(3)
  })

  it('never calls "not enabled" a missing source, and names the source it means', () => {
    expect(disabled).toContain('data-state="disabled"')
    expect(disabled).not.toContain(data.sourcesNotConfigured)
    // 规范五之二：未启用要在状态词后点名是哪个源。
    expect(disabled).toContain(`（${text.btc}）`)
    // 未配置与未启用都不是错误：不许出现平台的空/错状态面。
    for (const markup of [missing, disabled]) {
      expect(markup).not.toContain('class="state-view')
      expect(markup).not.toContain('data-state="empty"')
    }
  })

  it('draws a read failure as neither a normal card nor an empty one', () => {
    expect(unreadable).toContain('data-source-state="unreadable"')
    // 不许残留任何数字/图表：这三态读者拿不到数据。
    for (const markup of [missing, disabled, unreadable]) {
      expect(markup).not.toContain('mi-capital-conditions__etf-table')
      expect(markup).not.toContain('mi-capital-conditions__stable-table')
      expect(markup).not.toContain('mi-capital-conditions__etf-flow')
      expect(markup).not.toContain('data-state="empty"')
    }
  })

  it('gives each state exactly one primary action, and the ranking puts availability first', () => {
    // 每格一颗主动作：去配置 / 去启用 / 再采集。
    for (const [markup, label] of [
      [missing, data.configureSources],
      [disabled, data.enableSources],
      [unreadable, text.refresh]
    ] as const) {
      const actions = markup.match(/mi-source-card__actions/g) ?? []
      expect(actions).toHaveLength(1)
      expect(markup).toContain(label)
    }
    // 顺序：宿主说「没配置」时，即使读数这一格是读失败，也不许画成「读不到」。
    expect(render({ availability: { state: 'missing' }, state: { state: 'unavailable', reason: 'query-failed' } }))
      .toContain('data-state="missing"')
  })
})
