// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { settingsView } from '../../../service/intelligence/application/sourceProjection'
import { productText } from '../../shared/i18n/productText'
import { SourcesSettingsPane } from './SourcesSettingsPane'

/**
 * 频率那一行：**官方日历源（美联储日程 / BEA / BLS）显示「内置频率」，没有下拉**。
 *
 * 用户 2026-11-12 真机：「这个采集频率怎么还动不了」——那三个源是 registry-only 的日历 feed，
 * 节奏由产品自己的日历作业定，任何读取点都不读 profile 的 `collectionPreset`；之前因为目录里
 * 没有它们的条目、拿不到 `collectionOwner`，界面画成了可写下拉（假控件）。
 *
 * 反向：真正由通用适配器按预设采集的源（币安合约持仓）**仍然有下拉**。
 */
const t = productText['zh-CN'].settings.intelligenceSources
let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

const enabledById = Object.fromEntries(
  settingsView({ enabledById: {} }).groups
    .flatMap((group) => group.providers)
    .flatMap((provider) => provider.sources)
    .map((source) => [source.sourceId, true])
)

/**
 * BLS 那条今天带 `unavailable`（官方站点 403、自动同步已停）：**不可用的源不画频率行**（既有口径），
 * 所以测「节奏归谁」这份事实时把它暂时当作可用——那是这一笔要证的东西，不是 BLS 现在的可用性。
 */
function viewWithAvailableCalendar(): ReturnType<typeof settingsView> {
  const view = settingsView({ enabledById })
  return {
    ...view,
    groups: view.groups.map((group) => ({
      ...group,
      providers: group.providers.map((provider) => ({
        ...provider,
        sources: provider.sources.map((source) => {
          const { unavailable: _unavailable, ...rest } = source
          return rest as typeof source
        })
      }))
    }))
  }
}

async function render(business: 'dashboard' | 'calendar'): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(ShellLanguageProvider, {
      language: 'zh-CN',
      children: createElement(SourcesSettingsPane, {
        initialBusinessPosition: { business },
        filter: 'all',
        onFilterChange: vi.fn(),
        onSelectProvider: vi.fn(),
        pane: 'business',
        surface: {
          text: t,
          onDraftChange: vi.fn(),
          onRunNow: async () => undefined,
          onToggleSource: async () => true,
          policy: {
            labels: t.collectionPolicy,
            onChange: vi.fn(),
            /* 每源都给一份 profile：不存在的源拿不到 profile 就不画下拉，会让「仍有下拉」这条判据假绿。 */
            profiles: Object.fromEntries(Object.keys(enabledById).map((sourceId) => [sourceId, { sourceId, collectionPreset: 'balanced' }]))
          },
          showSourceDetails: true
        } as never,
        treeLabels: {
          title: t.title, categories: t.sourceCategories, providerNames: t.providerNames,
          unavailableCountOne: t.unavailableCountOne,
          unavailableCountOther: t.unavailableCountOther
        } as never,
        view: viewWithAvailableCalendar()
      })
    }))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return host
}

function presetRowOf(host: HTMLElement, sourceId: string): HTMLElement | null {
  return host.querySelector<HTMLElement>(`[data-preset-row="${sourceId}"]`)
}

describe('官方日历源的频率行是「内置频率」', () => {
  it('shows 内置频率 and no select for the three official calendar feeds', async () => {
    const host = await render('calendar')
    for (const sourceId of ['macro-calendar-fed', 'macro-calendar-bea', 'macro-calendar-bls']) {
      const row = presetRowOf(host, sourceId)
      expect(row, sourceId).not.toBeNull()
      expect(row!.getAttribute('data-preset-builtin'), sourceId).toBe('true')
      expect(row!.textContent, sourceId).toContain(t.collectionPolicy.builtinCadence)
      // 操作控件 0；唯一可聚焦的是那颗 ⓘ（说明「为什么内置」，不是控件）。
      expect(row!.querySelectorAll('select, [role="combobox"], [role="switch"], input'), sourceId).toHaveLength(0)
      const buttons = [...row!.querySelectorAll('button')]
      expect(buttons, sourceId).toHaveLength(1)
      expect(buttons[0]?.getAttribute('aria-label'), sourceId).toBe(t.collectionPolicy.builtinCadenceNoteAria)
    }
  })

  it('still gives a generic adapter source a working dropdown', async () => {
    const host = await render('dashboard')
    const row = presetRowOf(host, 'binance-futures-positioning')
    expect(row).not.toBeNull()
    expect(row!.getAttribute('data-preset-builtin')).toBeNull()
    expect(row!.querySelector('.ant-select-selector')).not.toBeNull()
  })
})
