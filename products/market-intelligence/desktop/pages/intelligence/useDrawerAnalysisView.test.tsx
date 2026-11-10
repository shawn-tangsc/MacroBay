// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { resolveProductTextKey } from '../../shared/i18n/productTextKey'
import type { DrawerRowView } from '../../settings/config-drawer/drawerScreenView'
import type { DrawerAnalysisFacts, DrawerSettingsTarget } from './useDrawerAnalysisView'
import { DRAWER_SETTINGS_TARGETS, drawerAnalysisFactsFrom, useDrawerAnalysisView } from './useDrawerAnalysisView'

/**
 * 配置抽屉「AI 分析」屏的只读视图。四态各钉一条，另外三条钉「不许编」：
 *
 * - 读好了 → 两行事实（开/关、哪个模型），值来自宿主给的那一份事实；
 * - 没选模型 → 就写「跟随默认助手模型」，**不许**编一个模型名；
 * - 选了却说不清是谁 → 值留空，**不回落成默认模型名**（那是另一个事实）；
 * - 读不到 → `error` + 重试，不是空态；
 * - 「没配置」也不是空态：默认配置本身就是一个值（关 / 跟随默认）。
 */
let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

type View = ReturnType<typeof useDrawerAnalysisView>

function Harness(input: Readonly<{
  read: () => Promise<DrawerAnalysisFacts>
  onOpenSettings: (target: DrawerSettingsTarget) => void
  onView: (view: View) => void
}>): null {
  input.onView(useDrawerAnalysisView(true, input.read, input.onOpenSettings))
  return null
}

async function mount(
  read: () => Promise<DrawerAnalysisFacts>,
  onOpenSettings: (target: DrawerSettingsTarget) => void = () => undefined
): Promise<Readonly<{ current: () => View; rerender: (nextRead: () => Promise<DrawerAnalysisFacts>) => Promise<void> }>> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  let latest: View
  const render = async (nextRead: () => Promise<DrawerAnalysisFacts>): Promise<void> => {
    await act(async () => {
      root!.render(createElement(ShellLanguageProvider, {
        language: 'zh-CN',
        children: createElement(Harness, { read: nextRead, onOpenSettings, onView: (view) => { latest = view } })
      }))
      // 两次 tick：一次给 read 的 promise，一次给 setState 后的重渲染。
      await Promise.resolve()
      await Promise.resolve()
    })
  }
  await render(read)
  return { current: () => latest, rerender: render }
}

const rowsOf = (view: View): readonly DrawerRowView[] => {
  if (view?.state !== 'ready') throw new Error(`expected ready, got ${view?.state ?? 'undefined'}`)
  return view.rows
}

describe('the drawer’s AI analysis screen', () => {
  it('starts in the loading state until the host read answers', async () => {
    let answer: ((facts: DrawerAnalysisFacts) => void) | undefined
    const read = (): Promise<DrawerAnalysisFacts> => new Promise((resolve) => { answer = resolve })
    const screen = await mount(read)
    expect(screen.current()).toEqual({ state: 'loading' })
    await act(async () => {
      answer?.({ enabled: true, model: { state: 'follows-default' } })
      await Promise.resolve()
    })
    expect(screen.current()?.state).toBe('ready')
  })

  it('shows the two facts it is given, reading exactly once', async () => {
    const read = vi.fn(async () => ({
      enabled: true,
      model: { state: 'named' as const, name: 'Anthropic / Claude Sonnet 4.5' }
    }))
    const screen = await mount(read)

    expect(rowsOf(screen.current()).map((row) => ({ key: row.key, value: row.value }))).toEqual([
      { key: 'configDrawer.rows.analysisSwitch', value: '开' },
      { key: 'configDrawer.rows.analysisModel', value: 'Anthropic / Claude Sonnet 4.5' }
    ])
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('says “follows the default” when no model is chosen, and never invents a model name', async () => {
    const screen = await mount(async () => ({ enabled: false, model: { state: 'follows-default' } }))
    const rows = rowsOf(screen.current())
    // 两句都是事实：关；没选模型所以跟随默认。**不是**某个模型名。
    expect(rows[0]?.value).toBe('关')
    expect(rows[1]?.value).toBe('跟随默认助手模型')
  })

  it('leaves the model cell empty when it cannot say which model, instead of guessing the default', async () => {
    const screen = await mount(async () => ({ enabled: true, model: { state: 'unknown' } }))
    const rows = rowsOf(screen.current())
    // 没有 `value` 这个键：抽屉画「—」。「你选的模型查不到」不许画成「你在用默认」。
    expect(rows[1]).not.toHaveProperty('value')
    expect(rows[0]?.value).toBe('开')
  })

  it('treats an unreadable read as an error with a retry, never as an empty screen', async () => {
    const screen = await mount(async () => { throw new Error('analysis-settings-unreadable') })
    const view = screen.current()
    expect(view?.state).toBe('error')
    // 空态的形式是 `ready + rows: []`，两者必须不同。
    expect(view?.state).not.toBe('ready')
  })

  it('reads again when the retry action runs, and shows the new answer', async () => {
    const read = vi.fn()
      .mockRejectedValueOnce(new Error('analysis-settings-unreadable'))
      .mockResolvedValueOnce({ enabled: true, model: { state: 'follows-default' } as const })
    const screen = await mount(read)
    const failed = screen.current()
    if (failed?.state !== 'error') throw new Error('expected error')
    await act(async () => {
      failed.onRetry()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(rowsOf(screen.current())[0]?.value).toBe('开')
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('never shows an empty screen: an unconfigured analysis is still two rows', async () => {
    // 「没配置」是一个值（关 / 跟随默认），不是「什么都没有」。这条挡住把默认配置画成空态。
    const screen = await mount(async () => ({ enabled: false, model: { state: 'follows-default' } }))
    const rows = rowsOf(screen.current())
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.key)).toEqual(['configDrawer.rows.analysisSwitch', 'configDrawer.rows.analysisModel'])
  })

  it('hands the host the “analysis” target, and never a switch of its own', async () => {
    const onOpenSettings = vi.fn<(target: DrawerSettingsTarget) => void>()
    const screen = await mount(
      async () => ({ enabled: true, model: { state: 'follows-default' } }),
      onOpenSettings
    )
    const rows = rowsOf(screen.current())
    for (const row of rows) {
      expect(row.action?.labelKey).toBe('configDrawer.actions.changeInSettings')
      expect(row.disabled).toBeUndefined()
    }
    await act(async () => {
      rows[0]?.action?.onSelect()
      rows[1]?.action?.onSelect()
    })
    // 两颗动作交出的是同一个闭集里的目标：这一屏只知道「要改分析设置」；打弹框还是跳页面归宿主。
    expect(onOpenSettings).toHaveBeenCalledTimes(2)
    expect(onOpenSettings.mock.calls).toEqual([['analysis'], ['analysis']])
  })

  it('keeps the settings targets a closed set, so a typo cannot reach the host', () => {
    // `DrawerSettingsTarget` 从这份数组推导：加目标只能在这里加，但传别的值（比如 'notifications'）
    // 在调用点就是编译错误。这条钉住今天恰好这三个，避免有人把它改成 `string`。
    expect(DRAWER_SETTINGS_TARGETS).toEqual(['preferences', 'models', 'analysis'])
    const targets: readonly DrawerSettingsTarget[] = DRAWER_SETTINGS_TARGETS
    expect(targets).toHaveLength(3)
  })

  it('does not read again when the host passes a new inline read on a re-render', async () => {
    // 宿主很容易写 `read={() => ...}`：内联函数每次渲染都是新的。读只该由「打开 / 重试」触发。
    const first = vi.fn(async () => ({ enabled: true, model: { state: 'follows-default' } as const }))
    const second = vi.fn(async () => ({ enabled: false, model: { state: 'follows-default' } as const }))
    const screen = await mount(first)
    await screen.rerender(second)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
  })

  it('renders only through copy keys that really exist, in both languages', () => {
    // 抽屉的行标签曾经在界面上显示成键名。这三个键必须两语都能解析出句子，缺一个即红。
    const keys = [
      'pages.intelligence.portal.dashboard.configDrawer.rows.analysisSwitch',
      'pages.intelligence.portal.dashboard.configDrawer.rows.analysisModel',
      'pages.intelligence.portal.dashboard.configDrawer.actions.changeInSettings',
      // 值里那句「跟随默认助手模型」用的是 AI 分析设置弹框那一句，同一句话只有一个出处。
      'pages.intelligence.portal.analysisTimeline.modelFollowDefault'
    ]
    for (const key of keys) {
      for (const language of ['zh-CN', 'en-US'] as const) {
        expect(resolveProductTextKey(language, key), `${key} (${language})`).not.toBe('')
      }
    }
  })
})

describe('the facts a host builds from what it read', () => {
  const providers = [{
    id: 'anthropic',
    name: 'Anthropic',
    models: [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' }]
  }]

  it('reads “no model chosen” as following the default', () => {
    expect(drawerAnalysisFactsFrom({
      settings: { enabled: true, providerId: '', modelId: '' },
      providers
    })).toEqual({ enabled: true, model: { state: 'follows-default' } })
  })

  it('names the chosen model with its provider', () => {
    expect(drawerAnalysisFactsFrom({
      settings: { enabled: true, providerId: 'anthropic', modelId: 'claude-sonnet-4-5' },
      providers
    })).toEqual({ enabled: true, model: { state: 'named', name: 'Anthropic / Claude Sonnet 4.5' } })
  })

  it('never falls back to the default when the chosen model cannot be found', () => {
    // 供应商被停用 / 模型下架 / 模型清单没读到，都是这个形状：说不出来，而不是「在用默认」。
    for (const input of [
      { settings: { enabled: true, providerId: 'missing', modelId: 'claude-sonnet-4-5' }, providers },
      { settings: { enabled: true, providerId: 'anthropic', modelId: 'retired-model' }, providers },
      { settings: { enabled: true, providerId: 'anthropic', modelId: 'claude-sonnet-4-5' }, providers: [] }
    ]) {
      expect(drawerAnalysisFactsFrom(input)).toEqual({ enabled: true, model: { state: 'unknown' } })
    }
  })
})
