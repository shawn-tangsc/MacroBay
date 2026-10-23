// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { PanelContainerMode, WorkspacePanelRegistration, WorkspacePanelResult, WorkspacePreparation, WorkspaceSize, WorkspaceSnapshot } from '@platform/workspace/contracts'
import { createPanelRegistry } from '@platform/workspace/registry/panelRegistry'
import { createPanelWorkspaceStore } from '@platform/workspace/runtime/panelWorkspaceStore'
import { platformText } from '../../i18n/platformText'
import { InspectorPanel } from './demo/InspectorPanel'
import { WorkspacePanelHost } from './WorkspacePanelHost'
import { createWorkspaceContentAdapter, type WorkspacePanelHostPort } from './workspaceHostAdapter'
import { WorkspaceUiPolicy } from './workspacePresentation'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const labels = platformText['en-US'].workspace

/**
 * PLAT-12：本文件全部用例都渲染**真实面板宿主 + 真实面板运行时 store**（只有端口是受控的）。
 * 实测（单跑 3 次 / 干净并集）：单用例最重 0.32–0.39s；10 路 CPU 竞争下 0.66s（≈1.7x）。
 * 历史 flaky 记录（P2-11/P2-12）：同文件用例单跑 0.31s、并集里被外部负载饿到 6.9s（≈22x）而触发默认 5s 超时。
 * ⇒ 给**本文件**（describe 级、非全局）一个有界预算：0.39s × 22 ≈ 8.6s，取 15s（≈1.7x 余量）。
 * 预算仍然有界：真挂起 / 真回归照样在 15s 失败。断言语义一字未改（本轮只加预算，无等待改写）。
 */
const SHELL_RENDER_TIMEOUT_MS = 15_000
let root: Root | undefined
afterEach(async () => { await act(async () => { root?.unmount() }); root = undefined; document.body.replaceChildren() })

type FixturePanelSpec = { title: string; minSize: WorkspaceSize; preferredSize: WorkspaceSize }

/** 面板实例数与逐实例注册尺寸可配（默认 2 个同尺寸面板）；用于同区域混合 presentation 等场景。 */
async function fixture(overrides: {
  supportedModes?: readonly PanelContainerMode[]
  language?: 'en-US' | 'zh-CN'
  /** 窗口级显示时区；默认 UTC，需要断言时区语义的用例显式覆盖。 */
  timeZone?: string
  minSize?: WorkspaceSize
  preferredSize?: WorkspaceSize
  withDetach?: boolean
  panels?: readonly FixturePanelSpec[]
} = {}) {
  const defaultMinSize = overrides.minSize ?? { width: 200, height: 150 }
  const defaultPreferredSize = overrides.preferredSize ?? { width: 300, height: 220 }
  const specs: readonly FixturePanelSpec[] = overrides.panels ?? [
    { title: 'Alpha', minSize: defaultMinSize, preferredSize: defaultPreferredSize },
    { title: 'Beta', minSize: defaultMinSize, preferredSize: defaultPreferredSize }
  ]
  const registration: WorkspacePanelRegistration = {
    panelId: 'platform.inspector', title: { 'en-US': 'Inspector', 'zh-CN': '检查器' }, icon: 'file-text', module: 'platform.inspector',
    pageIds: ['platform.demo'], supportedModes: overrides.supportedModes ?? ['embedded', 'docked-right', 'docked-bottom', 'detached'], defaultMode: 'embedded',
    allowMultipleInstances: true, minSize: specs[0].minSize, preferredSize: specs[0].preferredSize,
    binding: { persistence: 'none', maxKeyBytes: 256 }, lifecycleEvents: ['open', 'close']
  }
  const registry = createPanelRegistry({ pageIds: ['platform.demo'], moduleIds: ['platform.inspector'] })
  registry.register(registration); registry.seal()
  const store = createPanelWorkspaceStore({ panelRegistry: registry, pageIds: ['platform.demo'] })
  let sequence = 0
  const mutation = () => ({ requestId: String(++sequence), expectedRevision: store.getSnapshot().layoutRevision, hostEpoch: 1 })
  const workspace = await store.openWorkspace({ ...mutation(), pageId: 'platform.demo' })
  const opened: WorkspacePanelResult[] = []
  for (const [index, spec] of specs.entries()) {
    opened.push(await store.openPanel({ ...mutation(), workspaceInstanceKey: workspace.workspaceInstanceKey, panelId: registration.panelId, ...(index === 0 ? {} : { newInstance: true }) }))
  }
  const a = opened[0]; const b = opened[1]; const c = opened[2]
  const sizes = new Map<string, WorkspaceSize>()
  const projectedModes = new Map<string, PanelContainerMode>()
  const project = (): WorkspaceSnapshot => ({
    ...store.getSnapshot(),
    panels: store.getSnapshot().panels.map((p) => {
      const mode = projectedModes.get(p.panelInstanceKey)
      return { ...p, dockSize: sizes.get(p.panelInstanceKey), ...(mode === undefined ? {} : { mode }) }
    })
  })
  const state = { snapshot: project(), resizeCount: 0, resetCount: 0, switchCount: 0, detachCount: 0, reject: false, rejectedMutation: false, throws: false, preparation: { status: 'ready' } as WorkspacePreparation, disposed: 0 }
  const result = async (command: () => Promise<WorkspacePanelResult>): Promise<WorkspacePanelResult> => {
    if (state.throws) throw new Error('private failure payload')
    if (state.reject) {
      // 纠偏 R5：rejected 结果也可以携带真正变化过的权威快照，用来证伪「漏回传 onSnapshot」。
      if (state.rejectedMutation) await store.switchContainer({ ...mutation(), panelInstanceKey: a.panelInstanceKey, mode: 'embedded' })
      return { status: 'rejected', snapshot: project(), panelInstanceKey: a.panelInstanceKey, errorCode: 'stale-revision' }
    }
    const response = await command(); return { ...response, snapshot: project() }
  }
  const port: WorkspacePanelHostPort = {
    activate: ({ panelInstanceKey }) => result(() => store.activatePanel({ ...mutation(), panelInstanceKey })),
    switchContainer: ({ panelInstanceKey, mode }) => { state.switchCount += 1; return result(() => store.switchContainer({ ...mutation(), panelInstanceKey, mode })) },
    close: ({ panelInstanceKey }) => result(() => store.closePanel({ ...mutation(), panelInstanceKey })),
    reopen: () => result(() => store.openPanel({ ...mutation(), workspaceInstanceKey: workspace.workspaceInstanceKey, panelId: registration.panelId })),
    resize: ({ panelInstanceKey, size }) => result(async () => { state.resizeCount++; sizes.set(panelInstanceKey, size); return { status: 'applied', snapshot: project(), panelInstanceKey } }),
    reset: ({ panelInstanceKey }) => result(async () => { state.resetCount++; sizes.delete(panelInstanceKey); return { status: 'applied', snapshot: project(), panelInstanceKey } }),
    ...(overrides.withDetach
      ? {
          detach: async ({ panelInstanceKey }: { panelInstanceKey: string }): Promise<WorkspacePanelResult> => {
            state.detachCount += 1
            projectedModes.set(panelInstanceKey, 'detached')
            return { status: 'applied', snapshot: project(), panelInstanceKey }
          }
        }
      : {})
  }
  const adapter = createWorkspaceContentAdapter({ prepare: () => state.preparation, release: async () => { state.disposed++ } })
  const views = Object.fromEntries(opened.map((panel, index) => [panel.panelInstanceKey, {
    registration: { ...registration, minSize: specs[index].minSize, preferredSize: specs[index].preferredSize },
    title: specs[index].title,
    content: <div data-content-key={panel.panelInstanceKey}><InspectorPanel /></div>,
    adapter: index === 0 ? adapter : createWorkspaceContentAdapter({ prepare: () => ({ status: 'ready' }), release: async () => {} })
  }]))
  const options = { pageSize: { width: 1200, height: 900 }, language: (overrides.language ?? 'en-US') as 'en-US' | 'zh-CN', timeZone: overrides.timeZone ?? 'UTC' }
  let updateSnapshot: (value: WorkspaceSnapshot) => void = () => {}
  function Harness() {
    const [snapshot, setSnapshot] = useState(state.snapshot); updateSnapshot = setSnapshot
    return <WorkspacePanelHost workspaceInstanceKey={workspace.workspaceInstanceKey} snapshot={snapshot} onSnapshot={(value) => { state.snapshot = value; setSnapshot(value) }}
      language={options.language} timeZone={options.timeZone ?? 'UTC'} pageSize={options.pageSize} pageMinSize={{ width: 500, height: 300 }} views={views} port={port}>
      <input aria-label="Page draft" defaultValue="page remains" />
    </WorkspacePanelHost>
  }
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => { root!.render(<Harness />) })
  const refresh = async () => { state.snapshot = project(); await act(async () => { updateSnapshot(state.snapshot) }) }
  const move = async (key: string, mode: 'embedded' | 'docked-right' | 'docked-bottom') => { await store.switchContainer({ ...mutation(), panelInstanceKey: key, mode }); await refresh() }
  const close = async (key: string) => { await store.closePanel({ ...mutation(), panelInstanceKey: key }); await refresh() }
  const activate = async (key: string) => { await store.activatePanel({ ...mutation(), panelInstanceKey: key }); await refresh() }
  const resizePage = async (width: number, height = 900) => { options.pageSize = { width, height }; await refresh() }
  const frame = (key: string) => container.querySelector<HTMLElement>('[data-panel-key="' + key + '"]')!
  return { a: a.panelInstanceKey, b: b.panelInstanceKey, c: c?.panelInstanceKey, store, state, port, views, frame, container, move, close, activate, refresh, resizePage, sizes, options }
}

async function click(element: Element | null) { expect(element).not.toBeNull(); await act(async () => { (element as HTMLElement).click() }) }
async function menu(frame: HTMLElement, text: string, actionsLabel: string = labels.panelActions) {
  await click(frame.querySelector('[aria-label="' + actionsLabel + '"]'))
  const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find((node) => node.textContent === text)
  await click(item ?? null)
}
async function type(input: HTMLInputElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
async function pointer(element: HTMLElement, type: string, x: number, y = 0) {
  await act(async () => { element.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: x, clientY: y })) })
}

/** 三个同尺寸面板（Alpha/Beta 嵌入、Gamma 右停靠），用于窄屏区域呈现与不变量用例。 */
function narrowThreePanels(): FixturePanelSpec[] {
  return ['Alpha', 'Beta', 'Gamma'].map((title) => ({ title, minSize: { width: 200, height: 150 }, preferredSize: { width: 300, height: 220 } }))
}

/** 只统计「可见帧」里的标签：隐藏帧也渲染标签，用它做可达性断言会假绿。 */
function tabsInVisibleFrames(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-panel-key]'))
    .filter((frame) => frame.hidden === false)
    .flatMap((frame) => Array.from(frame.querySelectorAll<HTMLElement>('[role="tab"]')))
}
/** 某面板是否有真实可达控件：自身可见帧 / 可见帧内的标签 / 入口按钮。 */
function hasReachableControl(container: HTMLElement, key: string, title: string): boolean {
  const frame = container.querySelector<HTMLElement>('[data-panel-key="' + key + '"]')
  return frame?.hidden === false
    || tabsInVisibleFrames(container).some((tab) => tab.textContent === title)
    || container.querySelector('[data-entry-key="' + key + '"]') !== null
}
/** 可见性签名：可见帧集合 + 各自 presentation + 入口集合，用于断言「点击后确有状态变化」。 */
function visibilitySignature(container: HTMLElement): string {
  const frames = Array.from(container.querySelectorAll<HTMLElement>('[data-panel-key]'))
    .map((frame) => frame.dataset.panelKey + ':' + (frame.hidden ? 'hidden' : 'shown') + ':' + frame.dataset.presentation)
  const entries = Array.from(container.querySelectorAll<HTMLElement>('[data-entry-key]')).map((entry) => entry.dataset.entryKey ?? '')
  return [...frames.sort(), 'entries=' + entries.sort().join(',')].join('|')
}
/** 唯一可见帧的标签高亮项（I2：权威 active / 正文 / 高亮三者一致）。 */
function selectedTabTitle(container: HTMLElement, key: string): string | undefined {
  const frame = container.querySelector<HTMLElement>('[data-panel-key="' + key + '"]')
  return Array.from(frame?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])
    .find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent ?? undefined
}

/** 从渲染出的网格模板里取出所有固定 px 轨道，再反推页面轨道实际拿到的尺寸（不复制策略常量）。 */
function fixedTracks(template: string): number[] {
  return Array.from(template.matchAll(/(\d+(?:\.\d+)?)px/g)).map((match) => Number(match[1]))
}
function pageTrack(template: string, hostSize: number): number {
  return hostSize - fixedTracks(template).reduce((sum, value) => sum + value, 0)
}

describe('controlled workspace composition', { timeout: SHELL_RENDER_TIMEOUT_MS }, () => {
  it('keeps A and B state distinct across real activation and same-window moves', async () => {
    const f = await fixture(); await click(f.frame(f.b).querySelector('[role="tab"]'))
    const input = f.frame(f.a).querySelector<HTMLInputElement>('input')!
    await type(input, 'alpha draft'); await click(f.frame(f.a).querySelector('[aria-label="' + labels.inspectorSelection + '"]'))
    await click(Array.from(f.frame(f.a).querySelectorAll('[role="tab"]')).find((el) => el.textContent === 'Beta') ?? null)
    expect(f.frame(f.a).hidden).toBe(true); expect(f.frame(f.b).hidden).toBe(false)
    expect(f.frame(f.b).querySelector<HTMLInputElement>('input')?.value).toBe('')
    await menu(f.frame(f.b), labels.panelDockRight)
    expect(f.store.getSnapshot().panels.find((p) => p.panelInstanceKey === f.b)?.mode).toBe('docked-right')
    expect(f.frame(f.a).querySelector('input')).toBe(input); expect(input.value).toBe('alpha draft')
    expect(f.frame(f.a).textContent).toContain(labels.inspectorSelected)
    await menu(f.frame(f.a), labels.panelDockBottom)
    expect(f.frame(f.a).querySelector('input')).toBe(input)
  })
  it('renders page, right and bottom grid areas together and applies committed sizes', async () => {
    const f = await fixture(); await f.move(f.a, 'docked-right'); await f.move(f.b, 'docked-bottom')
    const host = f.container.querySelector<HTMLElement>('.workspace-panel-host')!
    expect(host.style.gridTemplateColumns).toContain('300px'); expect(host.style.gridTemplateRows).toContain('220px')
    expect(f.frame(f.a).style.gridArea).toBe('right'); expect(f.frame(f.b).style.gridArea).toBe('bottom')
    expect(f.container.querySelector<HTMLInputElement>('[aria-label="Page draft"]')?.value).toBe('page remains')
    const splitter = f.frame(f.a).querySelector<HTMLElement>('[role="separator"]')!
    await pointer(splitter, 'pointerdown', 900); await pointer(splitter, 'pointermove', 850); await pointer(splitter, 'pointermove', 820)
    expect(f.state.resizeCount).toBe(0); expect(host.style.gridTemplateColumns).toContain('380px')
    await pointer(splitter, 'pointerup', 820); expect(f.sizes.get(f.a)?.width).toBe(380)
    expect(host.style.gridTemplateColumns).toContain('380px')
    await menu(f.frame(f.a), labels.panelResetSize); expect(f.state.resetCount).toBe(1); expect(host.style.gridTemplateColumns).toContain('300px')
  })
  it('limits keyboard resize to the splitter axis and preserves page minimum', async () => {
    const f = await fixture(); await f.move(f.a, 'docked-right')
    const input = f.frame(f.a).querySelector<HTMLInputElement>('input')!
    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }); input.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false); expect(f.state.resizeCount).toBe(0)
    const splitter = f.frame(f.a).querySelector<HTMLElement>('[role="separator"]')!
    await act(async () => { splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })) })
    expect(f.sizes.get(f.a)?.width).toBe(316); expect(splitter.getAttribute('aria-orientation')).toBe('vertical')
    expect(splitter.getAttribute('aria-valuemax')).toBe('696')
    await pointer(splitter, 'pointerdown', 900); await pointer(splitter, 'pointermove', -9999); await pointer(splitter, 'pointerup', -9999)
    expect(f.sizes.get(f.a)?.width).toBe(696)
  })
  it('ignores cancel, lost capture, idle up and late events after unmount', async () => {
    const f = await fixture(); await f.move(f.a, 'docked-right')
    const splitter = f.frame(f.a).querySelector<HTMLElement>('[role="separator"]')!
    await pointer(splitter, 'pointerup', 1); expect(f.state.resizeCount).toBe(0)
    for (const ending of ['pointercancel', 'lostpointercapture']) {
      await pointer(splitter, 'pointerdown', 900); await pointer(splitter, 'pointermove', 800); await pointer(splitter, ending, 800); await pointer(splitter, 'pointerup', 800)
      expect(f.state.resizeCount).toBe(0)
    }
    await pointer(splitter, 'pointerdown', 900); await act(async () => { root!.unmount() }); root = undefined
    await pointer(splitter, 'pointerup', 800); expect(f.state.resizeCount).toBe(0)
  })
  it('returns to the real page, retains draft and reenters both narrow presentations', async () => {
    const f = await fixture(); await f.move(f.a, 'docked-right')
    const input = f.frame(f.a).querySelector<HTMLInputElement>('input')!; await type(input, 'narrow draft')
    for (const [width, presentation] of [[650, 'overlay'], [450, 'exclusive']] as const) {
      await f.resizePage(width); expect(f.frame(f.a).dataset.presentation).toBe(presentation)
      await act(async () => { f.frame(f.a).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
      expect(f.frame(f.a).hidden).toBe(true)
      const entry = f.container.querySelector<HTMLButtonElement>('[data-entry-key="' + f.a + '"]')!
      expect(document.activeElement).toBe(entry); expect(f.container.querySelector<HTMLElement>('.workspace-page')?.hidden).toBe(false)
      expect(f.store.getSnapshot().panels.find((p) => p.panelInstanceKey === f.a)).toMatchObject({ open: true, mode: 'docked-right' })
      await click(entry); expect(f.frame(f.a).hidden).toBe(false); expect(input.value).toBe('narrow draft')
      await f.resizePage(1200); expect(f.frame(f.a).dataset.presentation).toBe('normal')
    }
  })
  it('consumes rejected snapshots, catches thrown commands and preserves close drafts', async () => {
    const f = await fixture(); await f.move(f.a, 'docked-right'); const input = f.frame(f.a).querySelector<HTMLInputElement>('input')!
    await type(input, 'retain'); f.state.preparation = { status: 'handoff-required', reason: 'sensitive-draft' }
    await click(f.frame(f.a).querySelector('[aria-label="' + labels.panelClose + '"]')); expect(input.isConnected).toBe(true)
    f.state.preparation = { status: 'ready' }; f.state.reject = true
    await menu(f.frame(f.a), labels.panelDockBottom); expect(f.frame(f.a).style.gridArea).toBe('right')
    expect(f.container.querySelector('[role="alert"]')).not.toBeNull(); f.state.reject = false; f.state.throws = true
    await click(f.frame(f.a).querySelector('[aria-label="' + labels.panelClose + '"]')); expect(input.isConnected).toBe(true)
    expect(f.container.textContent).not.toContain('private failure payload'); expect(f.state.disposed).toBe(0)
    f.state.throws = false; await click(f.frame(f.a).querySelector('[aria-label="' + labels.panelClose + '"]'))
    expect(input.isConnected).toBe(false); expect(f.state.disposed).toBe(0)
    await click(f.container.querySelector('[data-entry-key="' + f.a + '"]'))
    expect(f.store.getSnapshot().panels.filter((p) => p.panelInstanceKey === f.a)).toHaveLength(1); expect(f.frame(f.a).hidden).toBe(false)
  })
  it('hands focus to a still connected reopen entry instead of body or the unmounting close button', async () => {
    const f = await fixture(); await f.move(f.a, 'docked-right')
    const closeButton = f.frame(f.a).querySelector<HTMLElement>('[aria-label="' + labels.panelClose + '"]')!
    expect(closeButton).not.toBeNull()
    await click(closeButton)
    const entry = f.container.querySelector<HTMLButtonElement>('[data-entry-key="' + f.a + '"]')
    expect(entry).not.toBeNull()
    expect(closeButton.isConnected).toBe(false)
    expect(entry!.isConnected).toBe(true)
    expect(document.activeElement).toBe(entry)
    expect(document.activeElement).not.toBe(document.body)
    expect(f.frame(f.a)).toBeNull()
  })
  it('enables menu modes from registration support plus port capability and acts on the enabled one', async () => {
    const f = await fixture({ supportedModes: ['embedded', 'docked-right', 'detached'] })
    await f.move(f.a, 'docked-right')
    await menu(f.frame(f.a), labels.panelEmbedded)
    expect(f.store.getSnapshot().panels.find((p) => p.panelInstanceKey === f.a)?.mode).toBe('embedded')
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    const find = (text: string) => items.filter((node) => node.textContent === text)
    expect(find(labels.panelEmbedded)[0]?.getAttribute('aria-disabled')).not.toBe('true')
    expect(find(labels.panelDockBottom)[0]?.getAttribute('aria-disabled')).toBe('true')
    expect(find(labels.panelDockBottom)[0]?.getAttribute('title')).toBe(labels.panelModeUnsupported)
    expect(find(labels.panelDetach)[0]?.getAttribute('aria-disabled')).toBe('true')
    expect(find(labels.panelDetach)[0]?.getAttribute('title')).toBe(labels.panelCapabilityMissing)
    expect(document.body.textContent).not.toContain(labels.panelUnsupported)
  })
  it('keeps disabled reasons localized so a missing capability is never reported as a space problem', async () => {
    const zh = platformText['zh-CN'].workspace
    expect(zh.panelModeUnsupported).not.toBe(labels.panelModeUnsupported)
    expect(zh.panelCapabilityMissing).not.toBe(labels.panelCapabilityMissing)
    expect(zh.panelUnsupported).not.toBe(labels.panelUnsupported)
    const f = await fixture({ supportedModes: ['embedded', 'docked-right', 'detached'], language: 'zh-CN' })
    await f.move(f.a, 'docked-right')
    await menu(f.frame(f.a), zh.panelEmbedded, zh.panelActions)
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    const bottom = items.filter((node) => node.textContent === zh.panelDockBottom)
    const detach = items.filter((node) => node.textContent === zh.panelDetach)
    expect(bottom[0]?.getAttribute('title')).toBe(zh.panelModeUnsupported)
    expect(detach[0]?.getAttribute('title')).toBe(zh.panelCapabilityMissing)
    expect(bottom[0]?.getAttribute('title')).not.toBe(zh.panelUnsupported)
    expect(detach[0]?.getAttribute('title')).not.toBe(zh.panelUnsupported)
  })
  it('consumes rejected and thrown commands with visible feedback and no unhandled rejection', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    try {
      const f = await fixture(); await f.move(f.a, 'docked-right')
      f.state.reject = true
      await menu(f.frame(f.a), labels.panelDockBottom)
      expect(f.container.querySelector('[role="alert"]')?.textContent).toBe(labels.panelCommandRejected)
      f.state.reject = false; f.state.throws = true
      await click(f.frame(f.a).querySelector('[aria-label="' + labels.panelClose + '"]')!)
      expect(f.container.querySelector('[role="alert"]')?.textContent).toBe(labels.panelCommandFailed)
      expect(f.container.textContent).not.toContain('private failure payload')
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
      expect(unhandled).toHaveLength(0)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
  it('keeps the splitter hit region inside the frame on a real grid track fed by one size source', async () => {
    const f = await fixture(); await f.move(f.a, 'docked-right')
    const host = f.container.querySelector<HTMLElement>('.workspace-panel-host')!
    const frame = f.frame(f.a)
    const splitter = frame.querySelector<HTMLElement>('[role="separator"]')!
    expect(splitter.parentElement).toBe(frame)
    expect(frame.contains(splitter)).toBe(true)
    expect(splitter.style.gridArea).toBe('splitter')
    expect(frame.style.gridArea).toBe('right')
    expect(host.style.getPropertyValue('--workspace-splitter-hit-size')).toBe(WorkspaceUiPolicy.splitterHitSize + 'px')
    expect(host.style.getPropertyValue('--workspace-title-height')).toBe(WorkspaceUiPolicy.titleHeight + 'px')
    expect(host.style.getPropertyValue('--workspace-splitter-size')).toBe(WorkspaceUiPolicy.splitterSize + 'px')
    expect(splitter.style.left).toBe(''); expect(splitter.style.top).toBe('')
    const css = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell/workspace/workspaceLayout.css'), 'utf8')
    const frameRules = css.match(/\.workspace-panel-frame(\[[^\]]*\])*\s*\{[^}]*\}/g) ?? []
    const trackedRules = frameRules.filter((rule) => rule.includes('splitter'))
    expect(trackedRules).toHaveLength(2)
    for (const rule of trackedRules) {
      expect(rule).toContain('grid-template-areas')
      expect(rule).toContain('var(--workspace-splitter-hit-size)')
      expect(rule).not.toMatch(/-\s*\d+px/)
      expect(rule).not.toContain('32px')
      expect(rule).not.toContain('8px')
    }
    const splitterRules = css.match(/\.workspace-panel-splitter[^{]*\{[^}]*\}/g) ?? []
    expect(splitterRules.length).toBeGreaterThan(0)
    for (const rule of splitterRules) {
      expect(rule).not.toMatch(/position:\s*absolute/)
      expect(rule).not.toMatch(/(left|top|right|bottom):\s*-/)
      expect(rule).not.toContain('8px')
    }
    expect(css).not.toContain('960px'); expect(css).not.toContain('720px')
  })
  it('keeps every open panel of one region reachable while that region is an overlay', async () => {
    const f = await fixture(); await f.move(f.a, 'docked-right'); await f.move(f.b, 'docked-right')
    await f.resizePage(650)
    expect(f.frame(f.a).dataset.presentation).toBe('overlay'); expect(f.frame(f.b).dataset.presentation).toBe('overlay')
    expect(f.frame(f.b).hidden).toBe(false); expect(f.frame(f.a).hidden).toBe(true)
    const tabs = Array.from(f.frame(f.b).querySelectorAll<HTMLElement>('[role="tab"]'))
    expect(tabs).toHaveLength(2)
    for (const [key, title] of [[f.a, 'Alpha'], [f.b, 'Beta']] as const) {
      // 只看可见帧内的标签：隐藏帧同样渲染标签，用它满足断言属假绿。
      expect(hasReachableControl(f.container, key, title)).toBe(true)
    }
    await click(tabs.find((tab) => tab.textContent === 'Alpha') ?? null)
    expect(f.frame(f.a).hidden).toBe(false); expect(f.frame(f.b).hidden).toBe(true)
    expect(f.store.getSnapshot().pageLayouts[0]?.activePanels['docked-right']).toBe(f.a)
  })
  it('keeps every open panel of one region reachable while that region is exclusive', async () => {
    const f = await fixture(); await f.move(f.a, 'docked-right'); await f.move(f.b, 'docked-right')
    await f.resizePage(450)
    expect(f.frame(f.b).dataset.presentation).toBe('exclusive')
    expect(f.frame(f.b).hidden).toBe(false); expect(f.frame(f.a).hidden).toBe(true)
    const tabs = Array.from(f.frame(f.b).querySelectorAll<HTMLElement>('[role="tab"]'))
    expect(tabs).toHaveLength(2)
    await click(tabs.find((tab) => tab.textContent === 'Alpha') ?? null)
    expect(f.frame(f.a).hidden).toBe(false); expect(f.frame(f.b).hidden).toBe(true)
    expect(f.frame(f.a).dataset.presentation).toBe('exclusive')
  })
  it('never squeezes the page below the injected page minimum for an embedded panel', async () => {
    const f = await fixture()
    const host = f.container.querySelector<HTMLElement>('.workspace-panel-host')!
    expect(f.frame(f.a).dataset.presentation).toBe('normal')
    expect(host.style.gridTemplateColumns).toBe('300px minmax(0, 1fr) 0px')
    await f.resizePage(650)
    expect(f.frame(f.a).dataset.presentation).toBe('overlay')
    expect(host.style.gridTemplateColumns).toBe('0px minmax(0, 1fr) 0px')
    expect(host.style.gridTemplateColumns).toContain('minmax(0, 1fr)')
    expect(f.container.querySelector<HTMLElement>('.workspace-page')?.hidden).toBe(false)
    expect(f.container.querySelector<HTMLInputElement>('[aria-label="Page draft"]')?.value).toBe('page remains')
  })
  it('degrades instead of collapsing the page when an embedded preferred width exceeds the page', async () => {
    const f = await fixture({ preferredSize: { width: 1280, height: 220 } })
    const host = f.container.querySelector<HTMLElement>('.workspace-panel-host')!
    await f.resizePage(300)
    expect(f.frame(f.a).dataset.presentation).toBe('exclusive')
    expect(host.style.gridTemplateColumns).toBe('0px minmax(0, 1fr) 0px')
    expect(host.style.gridTemplateColumns).not.toMatch(/-\d/)
    expect(host.style.gridTemplateRows).not.toMatch(/-\d/)
  })
  it('drops an uncommitted drag preview so a reopened panel renders the authoritative size', async () => {
    const f = await fixture(); await f.move(f.a, 'docked-right')
    const host = f.container.querySelector<HTMLElement>('.workspace-panel-host')!
    const splitter = f.frame(f.a).querySelector<HTMLElement>('[role="separator"]')!
    await pointer(splitter, 'pointerdown', 900); await pointer(splitter, 'pointermove', 800)
    expect(host.style.gridTemplateColumns).toContain('400px')
    await click(f.frame(f.a).querySelector('[aria-label="' + labels.panelClose + '"]'))
    expect(f.sizes.get(f.a)).toBeUndefined()
    await click(f.container.querySelector('[data-entry-key="' + f.a + '"]'))
    expect(host.style.gridTemplateColumns).toContain('300px')
    expect(host.style.gridTemplateColumns).not.toContain('400px')
  })
  it('routes the detach action through port.detach and consumes its authoritative snapshot', async () => {
    const f = await fixture({ supportedModes: ['embedded', 'docked-right', 'detached'], withDetach: true })
    await f.move(f.a, 'docked-right')
    await menu(f.frame(f.a), labels.panelDetach)
    expect(f.state.detachCount).toBe(1)
    expect(f.state.switchCount).toBe(0)
    expect(f.store.getSnapshot().panels.find((p) => p.panelInstanceKey === f.a)?.mode).toBe('docked-right')
    expect(f.container.querySelector('[data-panel-key="' + f.a + '"]')).toBeNull()
  })
  it('consumes the authoritative snapshot of a rejected command even when that snapshot changed', async () => {
    const f = await fixture(); await f.move(f.a, 'docked-right')
    expect(f.frame(f.a).style.gridArea).toBe('right')
    f.state.reject = true; f.state.rejectedMutation = true
    await menu(f.frame(f.a), labels.panelDockBottom)
    expect(f.container.querySelector('[role="alert"]')).not.toBeNull()
    expect(f.store.getSnapshot().panels.find((p) => p.panelInstanceKey === f.a)?.mode).toBe('embedded')
    expect(f.frame(f.a).style.gridArea).toBe('embedded')
  })
  it('previews and commits a bottom axis resize with a horizontal separator', async () => {
    const f = await fixture(); await f.move(f.a, 'docked-bottom')
    const host = f.container.querySelector<HTMLElement>('.workspace-panel-host')!
    const splitter = f.frame(f.a).querySelector<HTMLElement>('[role="separator"]')!
    expect(splitter.getAttribute('aria-orientation')).toBe('horizontal')
    expect(splitter.getAttribute('aria-valuemax')).toBe('596')
    expect(f.frame(f.a).style.gridArea).toBe('bottom')
    expect(host.style.gridTemplateRows).toContain('220px')
    await pointer(splitter, 'pointerdown', 900, 700); await pointer(splitter, 'pointermove', 900, 640)
    expect(f.state.resizeCount).toBe(0); expect(host.style.gridTemplateRows).toContain('280px')
    await pointer(splitter, 'pointerup', 900, 640)
    expect(f.sizes.get(f.a)?.height).toBe(280); expect(host.style.gridTemplateRows).toContain('280px')
    await act(async () => { splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })) })
    expect(f.state.resizeCount).toBe(1)
    await act(async () => { splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })) })
    expect(f.sizes.get(f.a)?.height).toBe(296)
  })
  it('returns to the page from the toolbar button and restores focus to a connected entry', async () => {
    const f = await fixture(); await f.move(f.a, 'docked-right'); await f.resizePage(650)
    const returnButton = f.frame(f.a).querySelector<HTMLButtonElement>('[aria-label="' + labels.panelReturnToPage + '"]')
    expect(returnButton).not.toBeNull()
    await click(returnButton)
    expect(f.frame(f.a).hidden).toBe(true)
    const entry = f.container.querySelector<HTMLButtonElement>('[data-entry-key="' + f.a + '"]')
    expect(entry).not.toBeNull(); expect(entry!.isConnected).toBe(true)
    expect(document.activeElement).toBe(entry); expect(document.activeElement).not.toBe(document.body)
    expect(f.container.querySelector<HTMLElement>('.workspace-page')?.hidden).toBe(false)
    expect(f.store.getSnapshot().panels.find((p) => p.panelInstanceKey === f.a)).toMatchObject({ open: true, mode: 'docked-right' })
    await click(entry)
    expect(f.frame(f.a).hidden).toBe(false)
  })
  it('restores the authoritative docked size when the window widens again', async () => {
    const f = await fixture(); await f.move(f.a, 'docked-right')
    const host = f.container.querySelector<HTMLElement>('.workspace-panel-host')!
    const splitter = f.frame(f.a).querySelector<HTMLElement>('[role="separator"]')!
    await pointer(splitter, 'pointerdown', 900); await pointer(splitter, 'pointermove', 820); await pointer(splitter, 'pointerup', 820)
    expect(host.style.gridTemplateColumns).toContain('380px')
    await f.resizePage(650)
    expect(f.frame(f.a).dataset.presentation).toBe('overlay')
    await f.resizePage(1200)
    expect(f.frame(f.a).dataset.presentation).toBe('normal')
    expect(host.style.gridTemplateColumns).toContain('380px')
  })
  it('shares one width budget between embedded and right so the page keeps pageMinSize', async () => {
    const f = await fixture({ minSize: { width: 320, height: 240 }, preferredSize: { width: 480, height: 360 } })
    await f.move(f.b, 'docked-right')
    const host = f.container.querySelector<HTMLElement>('.workspace-panel-host')!
    expect(f.frame(f.a).dataset.presentation).toBe('normal')
    expect(f.frame(f.b).dataset.presentation).toBe('normal')
    expect(host.style.gridTemplateColumns).toBe('380px minmax(0, 1fr) 320px')
    expect(fixedTracks(host.style.gridTemplateColumns).every((value) => value >= 0)).toBe(true)
    expect(pageTrack(host.style.gridTemplateColumns, 1200)).toBeGreaterThanOrEqual(500)
  })
  it('degrades the lower priority width region when even the joint minimum does not fit', async () => {
    const f = await fixture({ minSize: { width: 320, height: 240 }, preferredSize: { width: 480, height: 360 } })
    await f.move(f.b, 'docked-right'); await f.resizePage(900)
    const host = f.container.querySelector<HTMLElement>('.workspace-panel-host')!
    expect(f.frame(f.a).dataset.presentation).toBe('normal')
    expect(f.frame(f.b).dataset.presentation).toBe('overlay')
    // 存活区域宽度同时受单区域上限（900-500-4=396）与联合预算（900-500=400）约束，取较小者。
    expect(host.style.gridTemplateColumns).toBe('396px minmax(0, 1fr) 0px')
    expect(pageTrack(host.style.gridTemplateColumns, 900)).toBeGreaterThanOrEqual(500)
    // 被降级区域的面板仍然可达，且 mode/open 未被改动
    expect(f.frame(f.b).hidden === false || f.container.querySelector('[data-entry-key="' + f.b + '"]') !== null).toBe(true)
    expect(f.store.getSnapshot().panels.find((p) => p.panelInstanceKey === f.b)).toMatchObject({ open: true, mode: 'docked-right' })
  })
  it('never lets the bottom track push the page below the injected page minimum height', async () => {
    const f = await fixture({ preferredSize: { width: 300, height: 2000 } })
    await f.move(f.a, 'docked-bottom')
    const host = f.container.querySelector<HTMLElement>('.workspace-panel-host')!
    expect(host.style.gridTemplateRows).toBe('minmax(0, 1fr) 596px')
    expect(pageTrack(host.style.gridTemplateRows, 900)).toBeGreaterThanOrEqual(300)
    await f.resizePage(1200, 400)
    expect(f.frame(f.a).dataset.presentation).toBe('overlay')
    expect(host.style.gridTemplateRows).toBe('minmax(0, 1fr) 0px')
    expect(pageTrack(host.style.gridTemplateRows, 400)).toBeGreaterThanOrEqual(300)
  })
  it('never lets a closed panel consume the shared width budget of a visible region', async () => {
    const f = await fixture({ minSize: { width: 320, height: 240 }, preferredSize: { width: 480, height: 360 } })
    await f.move(f.b, 'docked-right')
    const host = f.container.querySelector<HTMLElement>('.workspace-panel-host')!
    // 反向对照：A 仍打开时按 WorkspaceWidthBudgetPriority 联合分配
    expect(host.style.gridTemplateColumns).toBe('380px minmax(0, 1fr) 320px')
    await f.close(f.a)
    expect(f.frame(f.a)).toBeNull()
    // 关闭的 embedded 面板不再占用宽度轴，右侧独占整条轴
    expect(host.style.gridTemplateColumns).toBe('0px minmax(0, 1fr) 480px')
    expect(pageTrack(host.style.gridTemplateColumns, 1200)).toBeGreaterThanOrEqual(500)
  })
  it('keeps the only visible width region normal when a closed panel would have exhausted the budget', async () => {
    const f = await fixture({ minSize: { width: 320, height: 240 }, preferredSize: { width: 480, height: 360 } })
    await f.move(f.b, 'docked-right'); await f.close(f.a); await f.resizePage(900)
    const host = f.container.querySelector<HTMLElement>('.workspace-panel-host')!
    expect(f.frame(f.b).dataset.presentation).toBe('normal')
    expect(host.style.gridTemplateColumns).toBe('0px minmax(0, 1fr) 396px')
    expect(pageTrack(host.style.gridTemplateColumns, 900)).toBeGreaterThanOrEqual(500)
  })
  it('keeps authoritative active, visible body and tab highlight consistent on the narrow path', async () => {
    const f = await fixture({ panels: narrowThreePanels() })
    const third = f.c
    if (third === undefined) throw new Error('third panel missing')
    await f.move(f.a, 'embedded'); await f.move(f.b, 'embedded'); await f.move(third, 'docked-right')
    await f.resizePage(650)
    await f.activate(f.a)
    expect(f.frame(f.a).hidden).toBe(true)
    const entryA = f.container.querySelector<HTMLElement>('[data-entry-key="' + f.a + '"]')
    expect(entryA).not.toBeNull()
    await click(entryA)
    expect(f.frame(f.a).hidden).toBe(false); expect(f.frame(f.b).hidden).toBe(true); expect(f.frame(third).hidden).toBe(true)
    await click(Array.from(f.frame(f.a).querySelectorAll<HTMLElement>('[role="tab"]')).find((tab) => tab.textContent === 'Beta') ?? null)
    // I2：权威 active / 可见帧正文 / 可见帧内标签高亮三者一致
    expect(f.store.getSnapshot().pageLayouts[0]?.activePanels.embedded).toBe(f.b)
    expect(f.frame(f.b).hidden).toBe(false); expect(f.frame(f.a).hidden).toBe(true)
    expect(selectedTabTitle(f.container, f.b)).toBe('Beta')
    expect(f.frame(f.b).querySelector('[data-content-key="' + f.b + '"]')).not.toBeNull()
    // I5：A/B/Gamma 都仍有可达控件
    for (const [key, title] of [[f.a, 'Alpha'], [f.b, 'Beta'], [third, 'Gamma']] as const) {
      expect(hasReachableControl(f.container, key, title)).toBe(true)
    }
  })
  it('never renders a narrow-path entry without a real visible effect', async () => {
    const f = await fixture({ panels: [
      { title: 'Alpha', minSize: { width: 600, height: 240 }, preferredSize: { width: 640, height: 300 } },
      { title: 'Beta', minSize: { width: 200, height: 150 }, preferredSize: { width: 300, height: 220 } },
      { title: 'Gamma', minSize: { width: 600, height: 240 }, preferredSize: { width: 640, height: 300 } }
    ] })
    const third = f.c
    if (third === undefined) throw new Error('third panel missing')
    await f.move(f.b, 'embedded'); await f.move(third, 'docked-right'); await f.activate(f.a); await f.resizePage(900)
    const visibleKeys = () => Array.from(f.container.querySelectorAll<HTMLElement>('[data-panel-key]'))
      .filter((frame) => frame.hidden === false).map((frame) => frame.dataset.panelKey)
    // I1：窄屏同一时刻至多呈现一个区域
    expect(visibleKeys()).toHaveLength(1)
    expect(visibleKeys()[0]).toBe(third)
    const entryKeys = () => Array.from(f.container.querySelectorAll<HTMLElement>('[data-entry-key]')).map((entry) => entry.dataset.entryKey ?? '')
    // 这就是 reviewer 报的「点不动的入口」：B 自身尺寸小被判 normal，但所在区域未被呈现
    expect(entryKeys()).toContain(f.b)
    const before = visibilitySignature(f.container)
    await click(f.container.querySelector('[data-entry-key="' + f.b + '"]'))
    expect(visibilitySignature(f.container)).not.toBe(before)
    expect(f.frame(f.b).hidden).toBe(false)
    expect(f.store.getSnapshot().pageLayouts[0]?.activePanels.embedded).toBe(f.b)
    expect(selectedTabTitle(f.container, f.b)).toBe('Beta')
    // I4 扫尾：此后每个仍渲染的入口点击后都必须有真实可见变化（不依赖收敛，只要求「不空转」）
    for (let round = 0; round < 3; round += 1) {
      const button = f.container.querySelector<HTMLElement>('[data-entry-key]')
      if (button === null) break
      const key = button.dataset.entryKey ?? ''
      const signature = visibilitySignature(f.container)
      await click(button)
      expect(visibilitySignature(f.container)).not.toBe(signature)
      expect(f.frame(key).hidden).toBe(false)
    }
    for (const [key, title] of [[f.a, 'Alpha'], [f.b, 'Beta'], [third, 'Gamma']] as const) {
      expect(hasReachableControl(f.container, key, title)).toBe(true)
    }
  })
  it('reopens a closed panel in one click while the workspace is showing the page', async () => {
    const f = await fixture(); await f.move(f.a, 'docked-right'); await f.close(f.a); await f.resizePage(650)
    await act(async () => { f.frame(f.b).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(f.frame(f.b).hidden).toBe(true)
    expect(f.container.querySelector<HTMLElement>('.workspace-page')?.hidden).toBe(false)
    const entry = f.container.querySelector<HTMLElement>('[data-entry-key="' + f.a + '"]')
    expect(entry).not.toBeNull()
    await click(entry)
    expect(f.store.getSnapshot().panels.find((p) => p.panelInstanceKey === f.a)?.open).toBe(true)
    expect(f.frame(f.a).hidden).toBe(false)
  })
  it('derives the presented narrow panel from the authoritative active panel plus one named transient state', async () => {
    const f = await fixture({ panels: narrowThreePanels() })
    const third = f.c
    if (third === undefined) throw new Error('third panel missing')
    await f.move(f.a, 'embedded'); await f.move(f.b, 'embedded'); await f.move(third, 'docked-right')
    await f.resizePage(650)
    // 无瞬时状态：呈现优先级最高窄屏区域（right）的权威 active
    expect(f.frame(third).hidden).toBe(false); expect(f.frame(f.a).hidden).toBe(true); expect(f.frame(f.b).hidden).toBe(true)
    // 区域级 pin：只决定呈现哪个区域，区域内仍由权威 active 决定
    await click(f.container.querySelector('[data-entry-key="' + f.a + '"]'))
    expect(f.frame(f.a).hidden).toBe(false); expect(f.frame(third).hidden).toBe(true)
    await f.activate(f.b)
    expect(f.store.getSnapshot().pageLayouts[0]?.activePanels.embedded).toBe(f.b)
    expect(f.frame(f.b).hidden).toBe(false); expect(f.frame(f.a).hidden).toBe(true)
    expect(selectedTabTitle(f.container, f.b)).toBe('Beta')
    // 瞬时状态不跨窗口宽度存活：变宽再变窄后仍由权威 active 决定
    await f.resizePage(1200)
    await f.resizePage(650)
    expect(f.frame(third).hidden).toBe(false)
  })
})
