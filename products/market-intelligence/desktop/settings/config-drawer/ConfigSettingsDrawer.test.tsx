// 抽屉目录的「不接数据」守卫（文件头先说规则，再说为什么）：
//
// **文案不是数据。** 允许 `../../shared/i18n/` 这一个前缀，是因为接 i18n 只是读静态文本，
// 不会让抽屉开始读视图或 IPC；IPC / 视图 / service 仍然**一律红**。
// 允许名单只放这一个前缀，别再随手加第二条——加一条就等于给「顺手接个数据」开了口子。
// @vitest-environment happy-dom
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfigSettingsDrawer } from './ConfigSettingsDrawer'
import type { DrawerRowView, DrawerScreenView } from './drawerScreenView'
import { DRAWER_MENUS, DRAWER_PREVIEW_SCREENS } from './drawerPreviewRows'

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
  document.body.replaceChildren()
})

/** antd `Drawer` 走 portal：内容挂在 document 上，不在我给的容器里。 */
function mount(menu: (typeof DRAWER_MENUS)[number]): HTMLElement {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(<ConfigSettingsDrawer initialMenu={menu} onClose={() => undefined} open />))
  return document.body
}


/** 平台屏的挂载助手：这两条用例只差「传了哪些值」。 */
function openPlatform(
  values: Record<string, string>,
  onOpen: (target: string) => void = () => undefined,
  onRetry?: () => void
): HTMLElement {
  document.body.replaceChildren()
  root?.unmount()
  root = undefined
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(
    <ConfigSettingsDrawer
      initialMenu="platform"
      onClose={() => undefined}
      onOpenPlatformSettings={onOpen as never}
      {...(onRetry === undefined ? {} : { onRetryPlatformValues: onRetry })}
      open
      platformValues={values}
      resolveText={(key) => key} />
  ))
  return document.body
}


/** 来源屏的挂载助手：这一屏现在只放宿主渲染好的那一块（旧的扁平源行已退役）。 */
function openSourcesPanel(panel: React.ReactNode): HTMLElement {
  document.body.replaceChildren()
  root?.unmount()
  root = undefined
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(
    <ConfigSettingsDrawer initialMenu="sources" onClose={() => undefined} open sourcesPanel={panel} />
  ))
  return document.body
}


/** 行屏挂载助手：用通知屏这条共用渲染路径验占位规则（通知/日报/处理同一条）。 */
function openRows(rows: ReadonlyArray<{ key: string; value?: string; emptyLabel?: string; reason?: string }>): HTMLElement {
  document.body.replaceChildren()
  root?.unmount()
  root = undefined
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(
    <ConfigSettingsDrawer
      initialMenu="notifications"
      notificationsView={{ state: 'ready', rows }}
      onClose={() => undefined}
      open
      resolveText={(key) => key} />
  ))
  return document.body
}

describe('config settings drawer (static layout)', () => {
  it('shows every registered menu, with the current one marked once', () => {
    // 七屏：来源 / 内容处理 / AI 分析 / 日报 / 通知 / 运行日志 / 平台与模型。
    const body = mount('sources')
    const items = [...body.querySelectorAll<HTMLElement>('.settings-nav-item')]
    expect(items).toHaveLength(DRAWER_MENUS.length)
    expect(items).toHaveLength(7)
    // 选中态是 `aria-current="page"`（设置页那套导航），编号格已经不在了。
    expect(items.filter((item) => item.getAttribute('aria-current') === 'page')).toHaveLength(1)
    expect(items.filter((item) => item.classList.contains('active'))).toHaveLength(1)
    // 本判据的红证 = 把 `<span className="config-drawer__nav-index">` 放回导航项，断言即挂
    // （2026-11-10 实测：`expected <span> to be null`）。断「不存在」的用例都照这个写法带一句怎么弄红。
    expect(body.querySelector('.config-drawer__nav-index')).toBeNull()
  })

  it('exposes one DOM snapshot per screen, and every screen has rows', () => {
    // 交付证据：六屏快照。值一律占位符，这一版不接任何数据。
    const snapshots = DRAWER_PREVIEW_SCREENS.map((screen) => {
      document.body.replaceChildren()
      root?.unmount()
      root = undefined
      const body = mount(screen.menu)
      const pane = body.querySelector<HTMLElement>('.config-drawer')
      return { menu: screen.menu, markup: pane?.outerHTML ?? '', rows: pane?.querySelectorAll('.config-drawer__row').length ?? 0 }
    })
    // 日报屏已接真数据、从静态清单移除，快照只剩还在占位的五屏。
    expect(snapshots).toHaveLength(DRAWER_PREVIEW_SCREENS.length)
    for (const snapshot of snapshots) {
      expect(snapshot.rows).toBeGreaterThan(0)
      expect(snapshot.markup).toContain('config-drawer__value')
    }
  })

  it('imports nothing from the data layer: the "no data" promise is falsifiable', () => {
    expect(dataLayerOffenders(readDrawerDirSources())).toEqual([])
  })

  it('catches a data-layer import when one appears: the guard is actually watching', () => {
    // 反证：「0 offenders」只证明没人写，不证明它在盯。喂一份假源码，守卫必须报出来。
    const fake = [{ name: 'FakeScreen.tsx', source: "import { intelligenceSourcesClient } from '../../shared/ipc/intelligenceSourcesClient'\n" }]
    expect(dataLayerOffenders(fake)).toEqual([
      "FakeScreen.tsx:1 imports '../../shared/ipc/intelligenceSourcesClient'"
    ])
  })

  it('tells "could not read" from "nothing there", and retries', () => {
    // 两种「空」长得像，必须分别断言：读不到 → error + 重试；确实没有 → empty。
    const onRetry = vi.fn()
    const open = (view: DrawerScreenView<DrawerRowView>): HTMLElement => {
      document.body.replaceChildren()
      root?.unmount()
      root = undefined
      host = document.createElement('div')
      document.body.append(host)
      root = createRoot(host)
      act(() => root?.render(
        <ConfigSettingsDrawer initialMenu="notifications" notificationsView={view} onClose={() => undefined} open />
      ))
      return document.body
    }

    const failed = open({ state: 'error', onRetry })
    expect(failed.querySelector('[data-drawer-screen="error"]')).not.toBeNull()
    expect(failed.querySelector('[data-drawer-screen="empty"]')).toBeNull()
    act(() => { failed.querySelector<HTMLElement>('.state-view__action')?.click() })
    expect(onRetry).toHaveBeenCalledTimes(1)

    const empty = open({ state: 'ready', rows: [] })
    expect(empty.querySelector('[data-drawer-screen="empty"]')).not.toBeNull()
    expect(empty.querySelector('[data-drawer-screen="error"]')).toBeNull()
  })

  it('renders the host rows, a per-row disabled property and an inline action', () => {
    document.body.replaceChildren()
    root?.unmount()
    root = undefined
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const onSelect = vi.fn()
    act(() => root?.render(
      <ConfigSettingsDrawer
        initialMenu="notifications"
        notificationsView={{ state: 'ready', rows: [
          { key: 'pushStrength', value: '最低强度' },
          { key: 'masterSwitch', value: '关', disabled: true, action: { labelKey: 'test', onSelect } }
        ] }}
        onClose={() => undefined}
        open />
    ))

    // 每屏根节点必须存在——只断「没报错」抓不到「什么都没渲染」。
    expect(document.querySelector('[data-drawer-screen="ready"]')).not.toBeNull()
    const rows = [...document.querySelectorAll<HTMLElement>('[data-drawer-row]')]
    expect(rows).toHaveLength(2)
    expect(rows[0]?.querySelector('.config-drawer__value')?.textContent).toBe('最低强度')
    expect(rows[1]?.className).toContain('is-disabled')
    expect(rows[0]?.className).not.toContain('is-disabled')
    act(() => { rows[1]?.querySelector<HTMLElement>('.config-drawer__row-action')?.click() })
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('shows the values the host passed, in four sections', () => {
    // 只证明「传了值就显示值」；缺值怎么画由下一条管。
    const container = openPlatform({
      timeZone: 'Asia/Shanghai',
      language: '中文',
      theme: '深色',
      proxy: '系统代理',
      modelService: '已配置'
    })
    const rows = [...container.querySelectorAll<HTMLElement>('[data-drawer-row]')]
    expect(rows.map((row) => row.querySelector('.config-drawer__value')?.textContent))
      .toEqual(['中文', 'Asia/Shanghai', '深色', '系统代理', '已配置'])
    expect(container.querySelectorAll('[data-platform-section]')).toHaveLength(4)
    expect(container.textContent).not.toContain('configDrawer.unreadable')
  })

  it('has exactly one "去平台设置" per section, and zero actions inside row bodies', () => {
    // 本轮规格：全屏最多四颗；行体内不许再出现跳转——button / a[href] / [role=link] 一起算。
    const container = openPlatform({ timeZone: 'Asia/Shanghai' })
    const sections = [...container.querySelectorAll<HTMLElement>('[data-platform-section]')]
    expect(sections).toHaveLength(4)

    for (const section of sections) {
      expect(section.querySelectorAll('[data-platform-section-action]')).toHaveLength(1)
      const rowBodies = [...section.querySelectorAll<HTMLElement>('[data-drawer-row]')]
      expect(rowBodies.length).toBeGreaterThan(0)
      for (const row of rowBodies) {
        // 行体内的「跳转/动作」必须为 0；唯一允许的按钮是原因 ⓘ（信息触发，不是动作）。
        const actions = [...row.querySelectorAll<HTMLElement>('button, a[href], [role="link"]')]
          .filter((element) => element.closest('[data-drawer-info]') === null)
        expect(actions).toHaveLength(0)
      }
    }
    expect(container.querySelectorAll('[data-platform-section-action]')).toHaveLength(4)
  })

  it('shows "could not read" for a missing platform value, with the reason behind an ⓘ', () => {
    // 这一屏最容易把「没读到」画成「没设置」：缺键必须显示状态词 + ⓘ，且不是空串。
    const container = openPlatform({ timeZone: 'Asia/Shanghai' })
    const rows = [...container.querySelectorAll<HTMLElement>('[data-drawer-row]')]
    expect(rows).toHaveLength(5)

    const missing = rows.filter((row) => row.getAttribute('data-drawer-row') !== 'timeZone')
    for (const row of missing) {
      const value = row.querySelector('.config-drawer__value')
      expect(value?.textContent).toContain('读不到')
      expect(value?.textContent).not.toContain('configDrawer.')
      // 原因只进 ⓘ：值位里必须有一颗可点的信息按钮。
      expect(value?.querySelector('button')).not.toBeNull()
    }
    // 有值的那一行照旧显示值，不套状态词。
    const present = rows.find((row) => row.getAttribute('data-drawer-row') === 'timeZone')
    expect(present?.querySelector('.config-drawer__value')?.textContent).toBe('Asia/Shanghai')
  })

  it('sends each section action to the host with its own navigation target', () => {
    const onOpen = vi.fn()
    const container = openPlatform({ timeZone: 'Asia/Shanghai' }, onOpen)

    const languageTime = container.querySelector<HTMLElement>('[data-platform-section="languageTime"] [data-platform-section-action]')
    act(() => { languageTime?.click() })
    expect(onOpen).toHaveBeenLastCalledWith('preferences')

    const models = container.querySelector<HTMLElement>('[data-platform-section="modelService"] [data-platform-section-action]')
    act(() => { models?.click() })
    expect(onOpen).toHaveBeenLastCalledWith('models')
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('offers a whole-screen re-read: inline when one row is missing, error state when all are', () => {
    // 重试是**读**不是保存：局部缺值一行状态词 + 一次重新读取；整屏都读不到才用错误态。
    const partialRetry = vi.fn()
    const partial = openPlatform({ timeZone: 'Asia/Shanghai' }, undefined, partialRetry)
    expect(partial.querySelector('[data-drawer-screen="error"]')).toBeNull()
    const retry = partial.querySelector<HTMLElement>('[data-platform-retry]')
    expect(retry).not.toBeNull()
    act(() => { retry?.click() })
    expect(partialRetry).toHaveBeenCalledTimes(1)

    const allRetry = vi.fn()
    const all = openPlatform({}, undefined, allRetry)
    expect(all.querySelector('[data-drawer-screen="error"]')).not.toBeNull()
    act(() => { all.querySelector<HTMLElement>('.state-view__action')?.click() })
    expect(allRetry).toHaveBeenCalledTimes(1)
  })

  it('renders the host-provided sources panel inside the two-column split', () => {
    // 抽屉这一层的判据只剩一条：宿主给的整块放进两栏，不再自己拼源行。
    const container = openSourcesPanel(<div data-panel="sources">the settings pane, moved in</div>)
    expect(container.querySelector('.config-drawer__split [data-panel="sources"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-drawer-source]')).toHaveLength(0)
  })

  it('keeps the split and a placeholder when the host passes no panel yet', () => {
    // 没有面板时不许空白：静态占位顶上（空屏比「—」更糟，读者会以为抽屉坏了）。
    const container = document.body
    const fallback = container.querySelector('.config-drawer__split')
    expect(fallback).toBeNull()
    const withFallback = mount('sources')
    expect(withFallback.querySelector('.config-drawer__split')).not.toBeNull()
    expect((withFallback.querySelector('.config-drawer__source-list')?.children.length ?? 0)).toBeGreaterThan(0)
  })

  it('never puts two empty markers in one row, and uses a status word for state-type gaps', () => {
    // 共享行为变更：通知 / 日报 / 处理等屏都走这条规则。
    const rowsWithGap = openRows([
      { key: 'translation', emptyLabel: '没启用' },
      { key: 'sentimentModel', value: '跟随快速模型：GPT-4.1' },
      { key: 'briefing?', emptyLabel: '未知：排期投影读不到' }
    ])
    for (const row of rowsWithGap.querySelectorAll<HTMLElement>('[data-drawer-row]')) {
      const text = row.textContent ?? ''
      expect((text.match(/—/gu) ?? []).length).toBeLessThanOrEqual(1)
      expect(text).not.toMatch(/—\s*—/u)
    }
    const cells = [...rowsWithGap.querySelectorAll<HTMLElement>('.config-drawer__value')].map((cell) => cell.textContent)
    // 状态类空值给状态词，不许给 `—`。
    expect(cells[0]).toBe('没启用')
    expect(cells[2]).toBe('未知：排期投影读不到')
  })

  it('keeps the reason out of the value and behind an ⓘ', () => {
    // 界面设计判据：正文只留「未知」，原因进该行 ⓘ 一颗。
    const container = openRows([{ key: 'configDrawer.rows.autoGeneration', emptyLabel: '未知', reason: '排期投影读不到' }])
    const row = container.querySelector<HTMLElement>('[data-drawer-row]')!
    const value = row.querySelector('.config-drawer__value')?.textContent
    expect(value).toBe('未知')
    expect(value).not.toContain('排期投影读不到')
    // 原因通道有对应元素（ⓘ 按钮），点在行内标签旁。
    expect(row.querySelectorAll('.config-drawer__label button')).toHaveLength(1)
  })

  it('renders the host-provided notifications panel instead of the placeholder rows', () => {
    // 这一屏搬的是设置页那一块（同一块实现）：宿主传了节点就只渲染它，不再叠一层静态行。
    document.body.replaceChildren()
    root?.unmount()
    root = undefined
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root?.render(
      <ConfigSettingsDrawer
        initialMenu="notifications"
        notificationsPanel={<div data-panel="notifications">the settings screen, moved in</div>}
        onClose={() => undefined}
        open />
    ))
    expect(document.body.querySelector('[data-panel="notifications"]')).not.toBeNull()
    expect(document.body.querySelectorAll('[data-drawer-row]')).toHaveLength(0)
  })

  it('renders the host-provided briefing panel instead of the placeholder rows', () => {
    // 日报这一屏搬的是简报设置抽屉里那两块：宿主传了节点就只渲染它。
    document.body.replaceChildren()
    root?.unmount()
    root = undefined
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root?.render(
      <ConfigSettingsDrawer
        briefingPanel={<div data-panel="briefing">the briefing settings, moved in</div>}
        initialMenu="briefing"
        onClose={() => undefined}
        open />
    ))
    expect(document.body.querySelector('[data-panel="briefing"]')).not.toBeNull()
    expect(document.body.querySelectorAll('[data-drawer-row]')).toHaveLength(0)
  })

  it('renders the host-provided processing panel instead of the static rows', () => {
    // 内容处理搬的是设置页那张翻译卡：宿主传了节点就只渲染它。
    document.body.replaceChildren()
    root?.unmount()
    root = undefined
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root?.render(
      <ConfigSettingsDrawer
        initialMenu="processing"
        onClose={() => undefined}
        open
        processingPanel={<div data-panel="processing">the translation card, moved in</div>} />
    ))
    expect(document.body.querySelector('[data-panel="processing"]')).not.toBeNull()
    expect(document.body.querySelectorAll('[data-drawer-row]')).toHaveLength(0)
  })

  it('renders the host-provided analysis panel instead of a second layout', () => {
    // AI 分析那一屏就是设置对话框的内容本体（inline），抽屉只把它放进来：不加标题、不加边距。
    document.body.replaceChildren()
    root?.unmount()
    root = undefined
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root?.render(
      <ConfigSettingsDrawer
        analysisPanel={<div data-panel="analysis">the analysis settings form, inline</div>}
        initialMenu="analysis"
        onClose={() => undefined}
        open />
    ))
    expect(document.body.querySelector('[data-panel="analysis"]')).not.toBeNull()
    expect(document.body.querySelectorAll('[data-drawer-row]')).toHaveLength(0)
  })

  it('shows the save bar only while the current screen reports unsaved edits', () => {
    // 壳只认屏上报的三样；没有脏就整屏只有内容（用户不许灰按钮）。
    const open = (props: Partial<React.ComponentProps<typeof ConfigSettingsDrawer>>): HTMLElement => {
      document.body.replaceChildren()
      root?.unmount()
      root = undefined
      host = document.createElement('div')
      document.body.append(host)
      root = createRoot(host)
      act(() => root?.render(<ConfigSettingsDrawer initialMenu="briefing" onClose={() => undefined} open {...props} />))
      return document.body
    }

    // 额外挂一个「假的测试屏」，证明壳里没有写死任何一屏——栏只看上报的脏与动作。
    const fakeScreen = <div data-fake-screen="true">screen</div>
    expect(open({ briefingPanel: fakeScreen }).querySelector('[data-drawer-savebar]')).toBeNull()

    const save = vi.fn()
    const dirty = open({ briefingPanel: fakeScreen, onScreenSave: save, screenDirty: true })
    const bar = dirty.querySelector<HTMLElement>('[data-drawer-savebar]')!
    expect(bar).not.toBeNull()
    act(() => { bar.querySelector<HTMLButtonElement>('.config-drawer__save')!.click() })
    expect(save).toHaveBeenCalledTimes(1)

    // 保存中不可连点。
    const saving = open({ briefinPanel: fakeScreen, onScreenSave: save, screenDirty: true, screenSaving: true } as never)
    expect(saving.querySelector<HTMLButtonElement>('.config-drawer__save')!.disabled).toBe(true)

    // 失败句在按钮上方一行、是 alert；栏仍在（可以再点）。
    const failed = open({ briefingPanel: fakeScreen, screenDirty: true, screenSaveFailure: '保存失败：AI 编辑' })
    const alert = failed.querySelector('[data-drawer-savebar] [role="alert"]')!
    expect(alert.textContent).toContain('保存失败：AI 编辑')
    expect(failed.querySelector('[data-drawer-savebar] .config-drawer__save')).not.toBeNull()

    // 保存成功后屏报 dirty=false：栏消失。
    expect(open({ briefingPanel: fakeScreen, screenDirty: false }).querySelector('[data-drawer-savebar]')).toBeNull()
  })

  it('keeps a bottom safe area only while the save bar is shown', () => {
    const open = (dirty: boolean): HTMLElement => {
      document.body.replaceChildren()
      root?.unmount()
      root = undefined
      host = document.createElement('div')
      document.body.append(host)
      root = createRoot(host)
      act(() => root?.render(<ConfigSettingsDrawer initialMenu="briefing" onClose={() => undefined} open screenDirty={dirty} />))
      return document.body
    }
    expect(open(true).querySelector<HTMLElement>('.config-drawer')!.style.scrollPaddingBottom).not.toBe('0px')
    expect(open(false).querySelector<HTMLElement>('.config-drawer')!.style.scrollPaddingBottom).toBe('0px')
  })

  it('asks before switching screens while the current one is dirty', () => {
    // 切走与关抽屉是同一件事：脏时都要先问。选「继续编辑」留在原屏，选「丢掉改动」才换屏。
    const asked: Array<{ onDiscard: () => void }> = []
    document.body.replaceChildren()
    root?.unmount()
    root = undefined
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root?.render(
      <ConfigSettingsDrawer
        confirmDiscard={((input: { onDiscard: () => void }) => { asked.push(input) }) as never}
        initialMenu="briefing"
        isScreenDirty={(menu) => menu === 'briefing'}
        onClose={() => undefined}
        open />
    ))
    const items = [...document.body.querySelectorAll<HTMLElement>('.settings-nav-item')]
    const before = document.body.querySelector('.config-drawer__pane-title')?.textContent

    act(() => { items[0]!.click() })
    expect(asked).toHaveLength(1)
    // 没有确认之前不换屏。
    expect(document.body.querySelector('.config-drawer__pane-title')?.textContent).toBe(before)

    act(() => { asked[0]!.onDiscard() })
    expect(document.body.querySelector('.config-drawer__pane-title')?.textContent).not.toBe(before)
  })

  it('trusts the host when it says the screen is dirty, even if no panel reported it', () => {
    // 来源屏的草稿由宿主合并进 `isScreenDirty`（`drawerScreen.dirty || sourcesDraftDirty`）。
    // 这条钉「壳只认 isScreenDirty 这一处输入」：壳自己不去问任何一屏。
    const onClose = vi.fn()
    const asked: Array<{ onDiscard: () => void }> = []
    document.body.replaceChildren()
    root?.unmount()
    root = undefined
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root?.render(
      <ConfigSettingsDrawer
        confirmDiscard={((input: { onDiscard: () => void }) => { asked.push(input) }) as never}
        initialMenu="sources"
        isScreenDirty={(menu) => menu === 'sources'}
        onClose={onClose}
        open />
    ))
    // 没有任何面板传 screenDirty —— 只有宿主那一处输入说脏。
    expect(document.body.querySelector('[data-drawer-savebar]')).toBeNull()
    act(() => { document.body.querySelector<HTMLElement>('.drawer__header-actions button')!.click() })
    expect(asked).toHaveLength(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('never prints an internal key name on any static screen', () => {
    // 自查一条：屏幕上不许出现 `configDrawer.*` 这类内部键名——键名进 DOM 等于把实现细节给读者看。
    for (const screen of DRAWER_PREVIEW_SCREENS) {
      document.body.replaceChildren()
      root?.unmount()
      root = undefined
      host = document.createElement('div')
      document.body.append(host)
      root = createRoot(host)
      act(() => root?.render(
        <ConfigSettingsDrawer initialMenu={screen.menu} onClose={() => undefined} open resolveText={(key) => key} />
      ))
      const text = document.body.textContent ?? ''
      expect(text).not.toMatch(/configDrawer\./u)
      expect(text).not.toMatch(/^[a-z]+\.[a-z]/iu)
    }
  })

/**
 * 抽屉目录的「不接数据」判据（纯函数：源码进、违规出行）。
 *
 * 允许的前缀只有：React、图标、**antd（控件库不是数据层）**、平台 UI、本目录、产品文案。
 * IPC、视图、产品 service 一律算违规。**文案不是数据**这条也在这里体现。
 */
function dataLayerOffenders(files: ReadonlyArray<{ name: string; source: string }>): string[] {
  // `../settingsInfo` 是**渲染件**（ⓘ 的唯一实现，只依赖平台 Popover/IconButton），不是数据层：
  // 按精确路径放行，不放开 `../` 前缀——那会把真正的数据层入口一起放进来。
  const allowedPrefixes = ['react', 'react-dom', 'lucide-react', 'antd', '@platform/ui/', './', '../../shared/i18n/', '../settingsInfo']
  return files.flatMap((file) => file.source.split('\n').flatMap((line, index) => {
    if (!/^import .* from '/u.test(line)) return []
    const specifier = /from '([^']+)'/u.exec(line)?.[1] ?? ''
    if (allowedPrefixes.some((prefix) => specifier.startsWith(prefix))) return []
    return [`${file.name}:${index + 1} imports '${specifier}'`]
  }))
}

/** 读抽屉目录里非测试的 .tsx。 */
function readDrawerDirSources(): ReadonlyArray<{ name: string; source: string }> {
  return readdirSync(__dirname)
    .filter((name) => name.endsWith('.tsx') && !name.includes('.test.'))
    .map((name) => ({ name, source: readFileSync(join(__dirname, name), 'utf8') }))
}

})

/**
 * 关窗前的守卫（界面设计 2026-11-10 签的判据）：
 *
 * 1. 只有真报脏才问；没改过就关，什么都不问；
 * 2. ✕ / 遮罩 / Esc 三条路径都过同一处前置检查；
 * 3. **先问再关**——确认之前关闭回调一次都不许被调；
 * 4. 确认后才调一次关闭。
 *
 * 弹窗本身（居中在抽屉之上、「继续编辑」在前且默认聚焦、Esc 等于继续编辑、「丢掉改动」静止即红
 * `ant-btn-dangerous`）由平台 `Confirm` 负责，已有 `Confirm.test.tsx` /
 * `ConfirmProvider.test.tsx` 断言；这里注入一个假的 `confirmDiscard`，只验抽屉「何时问、问几次、问完关一次」。
 */
describe('config drawer close guard', () => {
  function mountGuarded(isDirty: boolean, onClose: () => void = () => undefined, confirmDiscard: (input: { onDiscard: () => void }) => void = () => undefined): HTMLElement {
    document.body.replaceChildren()
    root?.unmount()
    root = undefined
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root?.render(
      <ConfigSettingsDrawer
        confirmDiscard={confirmDiscard as never}
        initialMenu="briefing"
        isScreenDirty={(menu) => menu === 'briefing' && isDirty}
        onClose={onClose}
        open />
    ))
    return document.body
  }

  const closeButton = (body: HTMLElement): HTMLElement => body.querySelector<HTMLElement>('.drawer__header-actions button')!

  it('asks before closing when the screen is dirty, and closes once only after the reader confirms', () => {
    const onClose = vi.fn()
    const asked: Array<{ onDiscard: () => void }> = []
    const body = mountGuarded(true, onClose, (input) => { asked.push(input) })
    act(() => { closeButton(body).click() })
    expect(asked).toHaveLength(1)
    // 先问再关：确认之前关闭回调一次都没被调。
    expect(onClose).not.toHaveBeenCalled()
    // 文案是抽屉给的这一份，宿主不另写一句。
    expect((asked[0] as unknown as { title: string }).title).toBe('有改动没保存，要丢掉吗？')
    act(() => { asked[0]!.onDiscard() })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('takes the same asking path on Escape and on a mask click', () => {
    const byMask = vi.fn()
    const maskAsked = vi.fn()
    const maskBody = mountGuarded(true, byMask, maskAsked)
    act(() => { maskBody.querySelector<HTMLElement>('.ant-drawer-mask')?.click() })
    expect(maskAsked).toHaveBeenCalledTimes(1)
    expect(byMask).not.toHaveBeenCalled()
    document.body.replaceChildren()

    const byEscape = vi.fn()
    const escAsked = vi.fn()
    const escBody = mountGuarded(true, byEscape, escAsked)
    // antd 的 Esc 监听挂在抽屉本身，且要求它在焦点里：先聚焦，再发 Esc（真实键盘就是这样）。
    const target = escBody.querySelector<HTMLElement>('.ant-drawer')
    act(() => {
      target?.focus()
      target?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape', keyCode: 27 }))
    })
    expect(escAsked).toHaveBeenCalledTimes(1)
    expect(byEscape).not.toHaveBeenCalled()
  })

  it('closes straight away, asking nothing, when the screen reports no unsaved edits', () => {
    const onClose = vi.fn()
    const asked = vi.fn()
    const body = mountGuarded(false, onClose, asked)
    act(() => { closeButton(body).click() })
    expect(asked).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
