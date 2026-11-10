// @vitest-environment happy-dom
import { act, createElement, useState, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfirmProvider, useConfirm } from '@platform/ui/components/confirm'
import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { ConfigSettingsDrawer } from '../../settings/config-drawer/ConfigSettingsDrawer'
import { DailyBriefingSettingsPanel, type BriefingScreenState } from './DailyBriefingSettingsPanel'

/**
 * 日报设置屏（重做版）的判据：脏的进出走 `onState`，三段与只读事实按设置页骨架渲染。
 *
 * 脏只认 `useDailyBriefingAiSettings.dirty` 一处：期列表的弹框立即写，不属于「未保存改动」。
 * 关闭守卫那三条在 `ConfigSettingsDrawer.test.tsx`，这里只判「屏报的脏」与「取消后屏与值还在」。
 */
let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

type BridgeOptions = Readonly<{
  settingsFails?: boolean
  saveFails?: boolean
  periods?: readonly { id: string; generationTime: string; windowHours: number; language: string }[]
  schedules?: 'missing' | 'registered' | 'none' | 'orphan'
  webSearchSupported?: boolean
}>

const aiView = {
  settings: { editorialEnabled: true, providerId: '', modelId: '', webSearchEnabled: false },
  language: {
    settings: { primary: 'follow-ui', additional: [] },
    plan: { locales: ['zh-CN'], primary: { requested: 'zh-CN', used: 'zh-CN' }, writeCount: 1 }
  },
  webSearchSupported: true,
  resolved: { state: 'disabled' }
}

function stubBridge(options: BridgeOptions = {}): void {
  const periods = options.periods ?? [{ id: 'default', generationTime: '07:00', windowHours: 24, language: 'zh-CN' }]
  const view = options.webSearchSupported === false
    ? { ...aiView, webSearchSupported: false }
    : aiView
  const invoke = vi.fn(async (_product: string, method: string) => {
    if (method === 'intelligence.dailyBriefing.getSettings') {
      if (options.settingsFails) throw new Error('settings-unreadable')
      return view
    }
    if (method === 'intelligence.dailyBriefing.saveSettings') {
      if (options.saveFails) return { state: 'unavailable', failureCode: 'failed' }
      return view
    }
    if (method === 'intelligence.dailyBriefing.listPeriods') return periods
    return undefined
  })
  const schedules = options.schedules ?? 'registered'
  const listSchedules = schedules === 'missing'
    ? undefined
    : vi.fn(async () => schedules === 'none'
      ? []
      : schedules === 'orphan'
        ? [{ id: 'market-intelligence.dailyBriefing.gone', productId: 'market-intelligence', registered: true, trigger: { kind: 'cron', expression: '0 7 * * *', timezone: null }, title: 't', owner: 'product', nextRunAt: null }]
        : periods.map((period) => ({
          id: `market-intelligence.dailyBriefing.${period.id}`,
          productId: 'market-intelligence',
          registered: true,
          trigger: { kind: 'cron' as const, expression: '0 7 * * *', timezone: null },
          title: 't',
          owner: 'product' as const,
          nextRunAt: null
        })))
  vi.stubGlobal('platform', {
    products: { invoke },
    modelProviders: { list: vi.fn(async () => []) },
    settings: { get: vi.fn(async () => ({ modelDefaults: { agentModelId: '' } })) },
    ...(listSchedules === undefined ? {} : { jobs: { listSchedules } })
  })
}

async function mount(options: BridgeOptions = {}): Promise<Readonly<{ host: HTMLElement; last: () => BriefingScreenState | undefined }>> {
  stubBridge(options)
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  let latest: BriefingScreenState | undefined
  function Probe(): ReactElement {
    const [state, setState] = useState<BriefingScreenState>({ dirty: false, saving: false, save: () => undefined })
    return <>
      <button data-probe-save="true" onClick={state.save} type="button">probe-save</button>
      <DailyBriefingSettingsPanel onState={(next) => { latest = next; setState(next) }} />
    </>
  }
  await act(async () => root!.render(
    <ShellLanguageProvider language="zh-CN"><ConfirmProvider><Probe /></ConfirmProvider></ShellLanguageProvider>
  ))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return { host, last: () => latest }
}

const switches = (host: HTMLElement): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('.ant-switch')]

describe('the briefing settings screen’s unsaved flag', () => {
  it('clears the unsaved flag when the screen is unmounted', async () => {
    const { host, last } = await mount()
    const toggle = switches(host)[0]
    expect(toggle).not.toBeUndefined()
    await act(async () => toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(last()?.dirty).toBe(true)

    await act(async () => root!.unmount())
    root = undefined
    expect(last()?.dirty).toBe(false)
  })

  it('reports no unsaved edits when the settings could not be read at all', async () => {
    const { host, last } = await mount({ settingsFails: true })
    expect(host.textContent).toContain('设置没读到，请重试。')
    expect(last()?.dirty).toBe(false)
  })

  it('keeps the draft dirty, and its value, when the save fails', async () => {
    const { host, last } = await mount({ saveFails: true })
    const toggle = switches(host)[0]
    await act(async () => toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(last()?.dirty).toBe(true)

    await act(async () => { last()?.save() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    expect(last()?.dirty).toBe(true)
    expect(last()?.failure).toContain('AI 编辑未保存')
    expect(switches(host)[0]?.getAttribute('aria-checked')).toBe('false')
  })

  it('reports no unsaved edits and no failure once the save goes through', async () => {
    const { host, last } = await mount()
    const toggle = switches(host)[0]
    await act(async () => toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(last()?.dirty).toBe(true)

    await act(async () => { last()?.save() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    expect(last()?.dirty).toBe(false)
    expect(last()?.failure).toBeUndefined()
  })
})

describe('the briefing settings screen’s three sections', () => {
  it('draws generation, AI editing and platform as settings blocks, with the period as a settings row', async () => {
    const { host } = await mount()
    expect(host.querySelectorAll('[data-settings-section-block="true"]')).toHaveLength(3)
    const row = host.querySelector<HTMLElement>('[data-period-id="default"]')!
    expect(row.classList.contains('config-drawer__row')).toBe(true)
    expect(row.querySelector('.config-drawer__label')?.textContent).toBe('第 1 期')
    expect(row.querySelector('.config-drawer__control')).not.toBeNull()
    expect(row.textContent).toContain('每天 07:00')
    expect(row.textContent).toContain('最近 24 小时')
    expect(row.textContent).toContain('中文')
    expect(row.querySelector('[data-period-edit="default"]')?.getAttribute('aria-label')).toBe('编辑第 1 期')
    expect(row.querySelector('[data-period-delete="default"]')?.getAttribute('aria-label')).toBe('删除第 1 期')
  })

  it('keeps「添加一期」out of the way when the period list cannot be read', async () => {
    stubBridge()
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(
      <ShellLanguageProvider language="zh-CN"><ConfirmProvider><DailyBriefingSettingsPanel onState={() => undefined} /></ConfirmProvider></ShellLanguageProvider>
    ))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(host.querySelector('[data-briefing-periods-empty="true"]')).toBeNull()
    expect(host.querySelector('[data-briefing-period-add="true"]')).not.toBeNull()
  })

  it('shows the registration fact as a word, hides it when there is no period, and never as 「关」', async () => {
    const registered = await mount({ schedules: 'registered' })
    expect(registered.host.querySelector('[data-briefing-auto]')?.getAttribute('data-briefing-auto')).toBe('registered')
    expect(registered.host.textContent).toContain('每天到点自动跑')

    await act(async () => root!.unmount()); root = undefined; document.body.replaceChildren()
    const missing = await mount({ schedules: 'missing' })
    expect(missing.host.querySelector('[data-briefing-auto]')?.getAttribute('data-briefing-auto')).toBe('unknown')
    expect(missing.host.textContent).toContain('未知')
    expect(missing.host.querySelector('[data-briefing-auto-retry="true"]')).not.toBeNull()

    await act(async () => root!.unmount()); root = undefined; document.body.replaceChildren()
    const orphan = await mount({ schedules: 'orphan' })
    expect(orphan.host.querySelector('[data-briefing-auto]')?.getAttribute('data-briefing-auto')).toBe('not-registered')

    await act(async () => root!.unmount()); root = undefined; document.body.replaceChildren()
    const empty = await mount({ periods: [], schedules: 'none' })
    expect(empty.host.querySelector('[data-briefing-auto]')).toBeNull()
  })

  it('gives the platform block exactly two jumps, one per row', async () => {
    const { host } = await mount()
    const jumps = [...host.querySelectorAll<HTMLElement>('[data-global-link]')]
    expect(jumps).toHaveLength(2)
    expect(jumps.map((jump) => jump.getAttribute('data-global-link'))).toEqual(['model-service', 'web-search'])
    expect(jumps.every((jump) => (jump.textContent ?? '').includes('去平台设置'))).toBe(true)
  })
})

describe('the drawer guard keeps the draft when the reader keeps editing', () => {
  function Probe({ onClose }: Readonly<{ onClose: () => void }>): ReactElement {
    const confirm = useConfirm()
    const [screen, setScreen] = useState<BriefingScreenState>({ dirty: false, saving: false, save: () => undefined })
    return <ConfigSettingsDrawer
      briefingPanel={<DailyBriefingSettingsPanel onState={setScreen} />}
      confirmDiscard={(input) => confirm({
        title: input.title,
        description: input.body,
        confirmLabel: input.confirmLabel,
        cancelLabel: input.cancelLabel,
        tone: 'danger',
        onConfirm: input.onDiscard
      })}
      initialMenu="briefing"
      isScreenDirty={() => screen.dirty}
      onClose={onClose}
      onScreenSave={screen.save}
      open
      screenDirty={screen.dirty}
      screenSaving={screen.saving}
      {...(screen.failure === undefined ? {} : { screenSaveFailure: screen.failure })} />
  }

  const confirmButton = (label: string): HTMLButtonElement | undefined =>
    [...document.body.querySelectorAll<HTMLButtonElement>('.ant-modal-confirm-btns button')]
      .find((button) => (button.textContent ?? '').replace(/\s+/gu, '') === label)

  it('keeps the screen and the value on 继续编辑, and closes only on 丢掉改动', async () => {
    stubBridge()
    const onClose = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(
      <ShellLanguageProvider language="zh-CN"><ConfirmProvider><Probe onClose={onClose} /></ConfirmProvider></ShellLanguageProvider>
    ))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    const body = document.body
    const toggle = switches(body)[0]
    expect(toggle).not.toBeUndefined()
    await act(async () => toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    const close = body.querySelector<HTMLElement>('.drawer__header-actions button')
    expect(close).not.toBeNull()
    await act(async () => close!.click())
    await act(async () => { await Promise.resolve() })
    expect(confirmButton('继续编辑')).not.toBeUndefined()
    await act(async () => confirmButton('继续编辑')!.click())
    await act(async () => { await Promise.resolve() })
    expect(onClose).not.toHaveBeenCalled()
    expect(body.querySelector('[data-briefing-settings-panel="true"]')).not.toBeNull()
    expect(switches(body)[0]?.getAttribute('aria-checked')).toBe('false')

    await act(async () => close!.click())
    await act(async () => { await Promise.resolve() })
    await act(async () => confirmButton('丢掉改动')!.click())
    await act(async () => { await Promise.resolve() })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

/**
 * 旧期列表块（`BriefingPeriodsPanel`）退役前，它那四条判据搬到这里。
 * 每条都只判行为，不判旧组件的类名。
 */
describe('the period list’s criteria, moved from the retired block', () => {
  const a = { id: 'period-a', generationTime: '08:00', windowHours: 24, language: 'zh-CN' }
  const b = { id: 'period-b', generationTime: '09:00', windowHours: 48, language: 'en-US' }

  function stubList(overrides: Readonly<{
    list?: (call: number) => Promise<unknown>
    update?: (...args: unknown[]) => Promise<unknown>
  }> = {}): { invoke: ReturnType<typeof vi.fn>; calls: { method: string; payload?: unknown }[] } {
    const calls: { method: string; payload?: unknown }[] = []
    let listCall = 0
    const invoke = vi.fn(async (_product: string, method: string, payload?: unknown) => {
      calls.push({ method, payload })
      if (method === 'intelligence.dailyBriefing.getSettings') return aiView
      if (method === 'intelligence.dailyBriefing.saveSettings') return aiView
      if (method === 'intelligence.dailyBriefing.listPeriods') {
        listCall += 1
        return overrides.list === undefined ? [a, b] : overrides.list(listCall)
      }
      if (method === 'intelligence.dailyBriefing.updatePeriod') {
        return overrides.update === undefined
          ? { state: 'saved', period: a, periods: [a, b] }
          : overrides.update(payload)
      }
      return undefined
    })
    vi.stubGlobal('platform', {
      products: { invoke },
      modelProviders: { list: vi.fn(async () => []) },
      settings: { get: vi.fn(async () => ({ modelDefaults: { agentModelId: '' } })) }
    })
    return { invoke, calls }
  }

  it('shows the empty state only when the store really has no periods', async () => {
    stubList({ list: async () => [] })
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(
      <ShellLanguageProvider language="zh-CN"><ConfirmProvider><DailyBriefingSettingsPanel onState={() => undefined} /></ConfirmProvider></ShellLanguageProvider>
    ))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(host.querySelector('[data-briefing-periods-empty="true"]')?.textContent).toContain('还没有设置任何一期')
    expect(host.querySelector('[data-period-id]')).toBeNull()

    await act(async () => root!.unmount()); root = undefined; document.body.replaceChildren()
    stubList()
    const filled = document.createElement('div')
    document.body.append(filled)
    root = createRoot(filled)
    await act(async () => root!.render(
      <ShellLanguageProvider language="zh-CN"><ConfirmProvider><DailyBriefingSettingsPanel onState={() => undefined} /></ConfirmProvider></ShellLanguageProvider>
    ))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(filled.querySelector('[data-briefing-periods-empty="true"]')).toBeNull()
    expect(filled.querySelectorAll('[data-period-id]')).toHaveLength(2)
  })

  it('re-reads after a read failure, and shows the periods instead of the empty state', async () => {
    const stub = stubList({
      list: (call) => call === 1 ? Promise.reject(new Error('list-failed')) : Promise.resolve([a])
    })
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(
      <ShellLanguageProvider language="zh-CN"><ConfirmProvider><DailyBriefingSettingsPanel onState={() => undefined} /></ConfirmProvider></ShellLanguageProvider>
    ))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    const retry = host.querySelector<HTMLButtonElement>('[data-briefing-periods-retry-load="true"]')
    expect(retry).not.toBeNull()
    await act(async () => retry!.click())
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(stub.calls.filter((call) => call.method === 'intelligence.dailyBriefing.listPeriods')).toHaveLength(2)
    expect(host.querySelector('[data-period-id="period-a"]')).not.toBeNull()
    expect(host.querySelector('[data-briefing-periods-empty="true"]')).toBeNull()
  })

  it('writes one period by id, does not touch the other, and re-reads the store afterwards', async () => {
    const stub = stubList()
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(
      <ShellLanguageProvider language="zh-CN"><ConfirmProvider><DailyBriefingSettingsPanel onState={() => undefined} /></ConfirmProvider></ShellLanguageProvider>
    ))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    // 打开第 1 期的编辑弹框，直接保存（草稿等于当前值，弹框允许保存）。
    await act(async () => host.querySelector<HTMLElement>('[data-period-edit="period-a"]')!.click())
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    const save = [...document.querySelectorAll<HTMLButtonElement>('.ant-modal button')]
      .find((button) => (button.textContent ?? '').replace(/\s+/gu, '') === '保存')
    expect(save).not.toBeUndefined()
    await act(async () => save!.click())
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    const writes = stub.calls.filter((call) => call.method === 'intelligence.dailyBriefing.updatePeriod')
    expect(writes).toHaveLength(1)
    expect((writes[0]!.payload as { id: string }).id).toBe('period-a')
    expect(stub.calls.some((call) => call.method === 'intelligence.dailyBriefing.createPeriod')).toBe(false)
    // 写完重读：不是相信回执。
    expect(stub.calls.filter((call) => call.method === 'intelligence.dailyBriefing.listPeriods')).toHaveLength(2)
    // 另一期原样还在。
    const rowB = host.querySelector<HTMLElement>('[data-period-id="period-b"]')?.textContent ?? ''
    expect(rowB).toContain('09:00')
    expect(rowB).toContain('48')
  })
})

describe('the AI block’s explanations live behind the row, not in the body', () => {
  it('turns the unsupported-search sentence into a 补查方式 row with its own ⓘ', async () => {
    const { host } = await mount({ webSearchSupported: false })
    expect(host.textContent).toContain('补查方式')
    expect(host.textContent).toContain('平台 Web Search')
    // 整句解释不在正文里（进 ⓘ 的浮层），正文只留行名与值。
    expect(host.textContent).not.toContain('当前模型不支持 Anthropic 内置搜索')
  })
})
