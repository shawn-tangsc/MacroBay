// @vitest-environment happy-dom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { resolveStateViewText } from '@platform/ui/components/state/stateViewText'
import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

import { productText } from '../../../shared/i18n/productText'
import { CapitalConditionsPanel, type DashboardSourceAvailability } from './CapitalConditionsPanel'
import type { DashboardCapitalConditionsState } from './capitalConditionsModel'

/**
 * 看板整卡级三态（界面设计 2026-11-11 按**形态**定）：**整卡**没有可用源 / 读不到 → 平台 `StateView`；
 * **行级、格级**才用共享可用性卡 `mi-source-*`。这条卡是整卡，所以三态一律 `StateView`，
 * 一个 `.mi-source-*` 都不许出现——同一位置两种画法会让读者以为它们是两件事。
 *
 * 四条判据各一条：三句互不相同；没启用不许说成「没有」；读不到不许画成正常或空态；每态恰一颗动作。
 * 顺序也钉住：宿主给了 `sourceAvailability` 时**先判它**，不看读数——没配置的源谈不上「读不到」。
 */
const text = productText['zh-CN'].pages.intelligence.portal.dashboard.capitalConditions
const dataText = productText['zh-CN'].pages.intelligence.portal.data
const actionLabel = (key: Parameters<typeof resolveStateViewText>[1]): string => resolveStateViewText('zh-CN', key)

function render(props: Readonly<{
  state?: DashboardCapitalConditionsState
  availability?: DashboardSourceAvailability
}>): string {
  return renderToStaticMarkup(createElement(ShellLanguageProvider, {
    language: 'zh-CN',
    children: createElement(ShellTimeZoneProvider, {
      timeZone: 'UTC',
      children: createElement(CapitalConditionsPanel, {
        text,
        state: props.state ?? { state: 'unavailable', reason: 'query-failed' },
        onRefresh: () => undefined,
        ...(props.availability ? { sourceAvailability: props.availability } : {})
      })
    })
  }))
}

const missing = render({ availability: { state: 'missing', onOpenSources: () => undefined } })
const disabled = render({ availability: { state: 'disabled', sourceLabel: text.btc, onOpenSources: () => undefined } })
const unreadable = render({})

/** 一个状态面里读者能按的按钮个数（提示条不算：它只报事，不带动作）。 */
function buttonCount(markup: string): number {
  return (markup.match(/<button\b/g) ?? []).length
}

describe('the three source states of the whole card', () => {
  it('says three different things for the three different causes', () => {
    expect(missing).toContain(dataText.sourcesNotConfigured)
    expect(disabled).toContain(dataText.sourcesNotEnabled)
    expect(unreadable).toContain(dataText.temporarilyUnavailable)
    // 三句两两不同：任何两句相同就说明有一态被另一态冒充了。
    expect(new Set([dataText.sourcesNotConfigured, dataText.sourcesNotEnabled, dataText.temporarilyUnavailable]).size).toBe(3)
    // 每一态只说自己那句，不许把别的态的句子一起印上。
    expect(missing).not.toContain(dataText.sourcesNotEnabled)
    expect(disabled).not.toContain(dataText.sourcesNotConfigured)
    expect(unreadable).not.toContain(dataText.sourcesNotConfigured)
  })

  it('draws the whole card through the platform state view, never through the shared row card', () => {
    for (const markup of [missing, disabled, unreadable]) {
      expect(markup).toContain('class="state-view')
      // 整卡级用共享卡就是画错了层：判据「把整卡改回共享卡必须红」。
      expect(markup).not.toContain('mi-source-card')
      expect(markup).not.toContain('mi-source-state')
      expect(markup).not.toContain('data-source-state=')
    }
  })

  it('never calls "not enabled" a missing source, and names the source it means', () => {
    // 未配置是空态面，未启用是停用面：两个图标轮廓不同，读者灰度下也分得开。
    expect(missing).toContain('data-state-icon="empty"')
    expect(disabled).toContain('data-state-icon="disabled"')
    for (const markup of [missing, disabled]) expect(markup).not.toContain('data-state-icon="error"')
    // 规范五之二：未启用要在状态词后点名是哪个源。
    expect(disabled).toContain(`（${text.btc}）`)
  })

  it('draws a read failure as neither a normal card nor an empty one, with exactly one action', () => {
    expect(unreadable).toContain('data-state-icon="error"')
    // 读者拿不到数据：任何数字/表格都不许残留。
    for (const markup of [missing, disabled, unreadable]) {
      expect(markup).not.toContain('mi-capital-conditions__etf-table')
      expect(markup).not.toContain('mi-capital-conditions__stable-table')
      expect(markup).not.toContain('mi-capital-conditions__etf-flow')
    }
    // 读不到恰一颗动作：重试（同一动作不许两颗按钮）。
    expect(buttonCount(unreadable)).toBe(1)
    expect(unreadable).toContain(actionLabel('ui.state.action.retry'))
    // 未配置 / 未启用也各只有一颗：打开设置 / 去启用（整卡只许用平台闭集里已有的动作）。
    expect(buttonCount(missing)).toBe(1)
    expect(missing).toContain(actionLabel('ui.state.action.open-settings'))
    expect(buttonCount(disabled)).toBe(1)
    expect(disabled).toContain(actionLabel('ui.state.action.enable'))
  })

  it('puts availability first: a card with no source is never drawn as a read failure', () => {
    expect(render({
      availability: { state: 'missing', onOpenSources: () => undefined },
      state: { state: 'unavailable', reason: 'query-failed' }
    })).toContain(dataText.sourcesNotConfigured)
  })
})
