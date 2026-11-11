// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { productText } from '../../shared/i18n/productText'
import { SourceConfigSurface, type SourceConfigSurfaceProps } from './SourceConfigSurface'
import { SourcesSettingsPane, type SourcesSettingsPaneProps } from './SourcesSettingsPane'
import type { ProviderView, SettingsView, SourceView } from '../../../service/intelligence/application/sourceProjection'

/**
 * C4：设置页与配置抽屉渲染的是**同一个 `SourcesSettingsPane`**。
 *
 * 判据不是「两条 props 生成路径长得像」，而是：同一个源、同一份选中状态，两个宿主各自交出的
 * props 渲染出来的**字段与状态逐项相同**（行、药丸、四格、采集策略、立即运行、行尾动作，顺序也同）。
 * 少交 `policy` 当场红——那正是以前「日历那侧连 policy 都没有」的缺口。
 */
const settingsText = productText['zh-CN'].settings.intelligenceSources

let root: Root | null = null

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

function source(overrides: Partial<SourceView> = {}): SourceView {
  const enabled = overrides.enabled ?? true
  const unavailable = overrides.unavailable !== undefined
  return {
    sourceId: 'macro-calendar-bls', providerId: 'bls', displayName: 'BLS official schedule',
    agents: ['crypto'], panels: ['economic-calendar'], visibility: 'visible', collection: 'provider',
    kind: 'official-calendar', capabilities: { runNow: 'provider', testConnection: true }, readiness: 'live',
    enabled, healthState: enabled ? (unavailable ? 'off' : 'healthy') : 'off', healthMarker: unavailable ? 'ring' : 'none',
    ...overrides
  }
}

function provider(view: SourceView): ProviderView {
  return { providerId: 'bls', displayName: 'Bureau of Labor Statistics (BLS)', category: 'macro', credential: 'none', healthMarker: 'none', sources: [view] }
}

function view(view: SourceView): SettingsView {
  return { groups: [{ category: 'macro', providers: [provider(view)] }], counts: { total: 1, enabled: 1, pending: 0, failed: 0 } }
}

function profiles(view: SourceView): Record<string, unknown> {
  return {
    [view.sourceId]: {
      profileId: `profile-${view.sourceId}`, sourceId: view.sourceId, enabled: view.enabled,
      collectionPreset: 'balanced' as const, scopePolicy: 'all' as const,
      rawArchiveEnabled: false, retentionMode: 'balanced' as const, autoReplayAfterParserUpgrade: false,
      updatedAt: '2026-11-01T00:00:00.000Z'
    }
  }
}

const TREE_LABELS: SourcesSettingsPaneProps['treeLabels'] = {
  title: settingsText.title,
  categories: settingsText.sourceCategories,
  providerNames: settingsText.providerNames,
  unavailableCountOne: settingsText.unavailableCountOne,
  unavailableCountOther: settingsText.unavailableCountOther
}

/**
 * 两个宿主各自的 props 形状（照抄调用点）：
 * - 设置页：`index.tsx`，带页面级 `notice`；
 * - 抽屉：`DashboardSourcesPanel.tsx`，无 `notice`。
 * 其余每一项都必须相同——这道用例就是拿它来比的。
 */
function settingsHost(sourceView: SourceView): SourcesSettingsPaneProps {
  return {
    filter: 'all',
    onFilterChange: () => undefined,
    onSelectProvider: () => undefined,
    selectedProviderId: 'bls',
    notice: <></>,
    treeLabels: TREE_LABELS,
    surface: surfaceOf(sourceView),
    view: view(sourceView)
  }
}

function drawerHost(sourceView: SourceView): SourcesSettingsPaneProps {
  return {
    filter: 'all',
    onFilterChange: () => undefined,
    onSelectProvider: () => undefined,
    selectedProviderId: 'bls',
    treeLabels: TREE_LABELS,
    surface: surfaceOf(sourceView),
    view: view(sourceView)
  }
}

function surfaceOf(sourceView: SourceView): SourcesSettingsPaneProps['surface'] {
  return {
    text: settingsText,
    policy: { labels: settingsText.collectionPolicy, onChange: () => undefined, profiles: profiles(sourceView) as never },
    supportsRunNowById: { [sourceView.sourceId]: true },
    onToggleSource: async () => true,
    onRunNow: async () => ({ kind: 'succeeded' as const, notice: '采集成功。' }),
    onDraftChange: () => undefined,
    showSourceDetails: true,
    surface: 'settings'
  }
}

/** happy-dom 每次挂载的 `useId` 都不同；把纯挂载标识归一化掉，比的是内容。 */
function normalize(html: string): string {
  return html
    .replace(/ id="[^"]*"/g, '')
    .replace(/ aria-describedby="[^"]*"/g, '')
    .replace(/ aria-controls="[^"]*"/g, '')
}

async function renderPane(props: SourcesSettingsPaneProps): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(ShellTimeZoneProvider, { timeZone: 'Asia/Shanghai', children: createElement(SourcesSettingsPane, props) }))
    await Promise.resolve()
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return container
}

async function signature(props: SourcesSettingsPaneProps): Promise<{ tree: string; detail: string }> {
  const container = await renderPane(props)
  const tree = container.querySelector('.intelligence-catalog-pane')?.textContent ?? ''
  const detail = normalize(container.querySelector('.settings-detail-pane')?.innerHTML ?? '')
  await act(async () => root?.unmount()); root = null
  document.body.replaceChildren()
  return { tree, detail }
}

describe('the settings page and the config drawer render the same sources pane (C4)', () => {
  it('matches field for field and state for state on an unavailable source', async () => {
    const sourceView = source({
      unavailable: { reasonCode: 'official-endpoint-returned-403', automaticSync: 'stopped', lastSuccessfulSyncAt: '2026-10-22T07:29:41.000Z', decidedAt: '2026-11-08' }
    })
    const fromSettings = await signature(settingsHost(sourceView))
    const fromDrawer = await signature(drawerHost(sourceView))

    expect(fromDrawer).toEqual(fromSettings)
    // 「逐项一致」不是「两边都少同一项」：源行还在（名字 + 开关 + 药丸）。
    // 「高级」与整个展开区已按用户 2026-11-12 删除，详情里不再有健康四格 / 采集策略。
    expect(fromSettings.detail).toContain('BLS 官方日程')
    expect(fromSettings.detail).toContain('source-provider-detail__row')
    expect(fromSettings.detail).not.toContain('source-provider-detail__advanced')
    expect(fromSettings.detail).not.toContain(settingsText.collectionPolicy.collectionPreset)
    // 目录一侧同样逐项一致（含那颗「不可用源」数量标记）。
    expect(fromSettings.tree).toContain(settingsText.unavailableCountOne.replace('{count}', '1'))
  })

  it('matches field for field and state for state on a healthy source', async () => {
    const sourceView = source()
    const fromSettings = await signature(settingsHost(sourceView))
    const fromDrawer = await signature(drawerHost(sourceView))
    expect(fromDrawer).toEqual(fromSettings)
    expect(fromSettings.detail).toContain('BLS 官方日程')
    expect(fromSettings.detail).not.toContain('source-provider-detail__advanced')
    expect(fromSettings.detail).not.toContain(settingsText.health.runAction.run)
  })



  it('both hosts hand the pane the same facts and callbacks, and declare the settings surface', () => {
    const settingsBlock = surfaceBlock('./index.tsx')
    const drawerBlock = surfaceBlock('../../pages/intelligence/DashboardSourcesPanel.tsx')
    const required = ['text:', 'policy:', 'supportsRunNowById', 'onRunNow:', 'onToggleSource:', 'onDraftChange:', "surface: 'settings'"]
    for (const block of [settingsBlock, drawerBlock]) {
      for (const key of required) expect(block).toContain(key)
    }
  })
})

/** 取宿主文件里 `surface={{ … }}` 那一段（到声明的面为止），守卫只看这一段。 */
function surfaceBlock(relativePath: string): string {
  const marker = "surface: 'settings'"
  const file = new URL(relativePath, import.meta.url)
  const source = readFileSync(file, 'utf8')
  const start = source.indexOf('surface={{')
  const end = source.indexOf(marker, start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end + marker.length)
}

describe('the config surface adapts a host that only has the three write callbacks', () => {
  it('writes enabling only through the header group switch', async () => {
    const write = vi.fn(async (_source: Readonly<{ sourceId: string; kind: string }>, _enabled: boolean, _origin: string) => {})
    const run = vi.fn(async () => {})
    const sourceView = source()
    const props: SourceConfigSurfaceProps = {
      text: settingsText,
      provider: provider(sourceView),
      policy: { labels: settingsText.collectionPolicy, onChange: () => undefined, profiles: profiles(sourceView) as never },
      supportsRunNowById: { [sourceView.sourceId]: true },
      onWriteSourceEnabled: write,
      writeOrigin: 'calendar-drawer',
      onRunSource: run,
      showSourceDetails: true
    }
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(ShellTimeZoneProvider, { timeZone: 'Asia/Shanghai', children: createElement(SourceConfigSurface, props) }))
      await Promise.resolve()
    })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    // 「立即运行」随展开区一起删除（用户 2026-11-12）：这里不再有那颗按钮。
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === settingsText.health.runAction.run)).toBe(false)

    // 启停的编辑入口是页头那颗组开关（用户 2026-11-12）；能力行行尾是文字状态。
    // 只看能力行（启用）那几行：策略表单里还有「纳入情绪分析」开关，它不是启停入口。
    expect(container.querySelectorAll('[data-setting-key^="setting:sources.enabled"] button[role="switch"]')).toHaveLength(0)
    for (const row of container.querySelectorAll('[data-setting-key^="setting:sources.enabled"]')) {
      // 行上唯一的控件是这颗源自己的「测试」（读者 2026-11-12：每个已接入的源都要能测连通性）；
      // 启停仍是页头组开关——行上不许出现开关、下拉或输入框。
      expect(row.querySelectorAll('select, input')).toHaveLength(0)
      for (const button of row.querySelectorAll('button')) {
        expect(button.classList.contains('source-provider-detail__row-test'), button.textContent ?? '').toBe(true)
      }
      expect(row.querySelector('.source-provider-detail__row-state')?.textContent).not.toBe('')
    }
    expect(write).not.toHaveBeenCalled()

    // 页头组开关走宿主那条写入口，并带上宿主声明的 origin。
    const header = container.querySelector<HTMLButtonElement>('.source-provider-detail__group-toggle button[role="switch"]')
    expect(header?.disabled).toBe(false)
    await act(async () => { header?.click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0]?.[1]).toBe(false)
    expect(write.mock.calls[0]?.[2]).toBe('calendar-drawer')
  })
})
