// @vitest-environment happy-dom
import { act, createElement, useState, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfirmProvider, useConfirm } from '@platform/ui/components/confirm'
import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { openModelSettings, openWebSearchSettings } from '../../shared/navigation/productShellNavigation'
import { ConfigSettingsDrawer } from '../../settings/config-drawer/ConfigSettingsDrawer'
import { DailyBriefingSettingsPanel, type BriefingSection, type BriefingScreenState } from './DailyBriefingSettingsPanel'

vi.mock('../../shared/navigation/productShellNavigation', () => ({
  openModelSettings: vi.fn(),
  openWebSearchSettings: vi.fn()
}))

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
  periodWriteRejects?: boolean
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
    if (method === 'intelligence.dailyBriefing.updatePeriod' && options.periodWriteRejects) {
      return { state: 'rejected', code: 'daily-briefing-period-invalid', issue: 'window-hours' }
    }
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

async function mount(
  options: BridgeOptions = {},
  initialSection?: BriefingSection
): Promise<Readonly<{ host: HTMLElement; last: () => BriefingScreenState | undefined }>> {
  stubBridge(options)
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  let latest: BriefingScreenState | undefined
  function Probe(): ReactElement {
    const [state, setState] = useState<BriefingScreenState>({ dirty: false, saving: false, save: () => undefined })
    return <>
      <button data-probe-save="true" onClick={state.save} type="button">probe-save</button>
      <DailyBriefingSettingsPanel
        onState={(next) => { latest = next; setState(next) }}
        {...(initialSection === undefined ? {} : { initialSection })} />
    </>
  }
  await act(async () => root!.render(
    <ShellLanguageProvider language="zh-CN"><ConfirmProvider><Probe /></ConfirmProvider></ShellLanguageProvider>
  ))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return { host, last: () => latest }
}

const switches = (host: HTMLElement): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('.ant-switch')]

/** 说明浮层的内容：AntD 关掉后仍留在 DOM 里（带 hidden 类），所以只读「显示中」的那几个。 */
function visiblePopoverText(): string {
  return [...document.querySelectorAll('.ant-popover')]
    .filter((element) => !element.classList.contains('ant-popover-hidden')
      && !/ant-zoom-.*-(leave|leave-active)/.test(element.className))
    .map((element) => element.querySelector('.platform-popover__content')?.textContent ?? '')
    .join(' ')
}

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

describe('the briefing settings screen’s two sections', () => {
  it('draws generation and AI editing as settings blocks, with the period as a settings row', async () => {
    const { host } = await mount()
    expect(host.querySelectorAll('[data-settings-section-block="true"]')).toHaveLength(2)
    // 平台那一段已经不在屏上：两个跳转跟着被说明的项走（见下一条）。
    expect(host.textContent).not.toContain('平台设置')
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

  it('draws its blocks flat, because the drawer already draws the card around them', async () => {
    // 抽屉正文本身就是一张卡（`ConfigDrawerContentCard`）。区块再画一遍框 = 双框 + 双重内距
    // （左缩进 30）。形态由 `SettingsSection` 的两档定义，调用点只说「我在卡里」。
    const { host } = await mount()
    const blocks = [...host.querySelectorAll<HTMLElement>('[data-settings-section-block="true"]')]
    expect(blocks.map((block) => block.getAttribute('data-variant'))).toEqual(['flat', 'flat'])
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

  it('puts each platform jump at the end of the row it explains, and nowhere else', async () => {
    const { host } = await mount({ webSearchSupported: false })
    expect(host.querySelectorAll('[data-global-link]')).toHaveLength(2)
    const jump = (link: string): HTMLElement | null | undefined =>
      host.querySelector<HTMLElement>(`[data-global-link="${link}"]`)

    // 模型服务 → 「模型」那一行，行尾最右
    const modelJump = jump('model-service')
    const modelRow = modelJump?.closest<HTMLElement>('.config-drawer__row')
    expect(modelRow?.querySelector('.config-drawer__label')?.textContent).toContain('模型')
    // 控件列撑满行内剩余宽度，跳转是这一列的最后一项（行尾最右）。
    expect(modelRow?.querySelector('.config-drawer__control')?.lastElementChild).toBe(modelJump)
    expect(modelJump?.textContent).toBe('去模型服务')

    // 搜索供应商 → 「补查方式」那一行，行尾最右
    const searchJump = jump('web-search')
    const searchRow = searchJump?.closest<HTMLElement>('.config-drawer__row')
    expect(searchRow?.querySelector('.config-drawer__label')?.textContent).toContain('补查方式')
    expect(searchRow?.querySelector('.config-drawer__control')?.lastElementChild).toBe(searchJump)
    expect(searchJump?.textContent).toBe('去搜索供应商')

    // 全屏不再出现第三颗「去平台设置」
    expect(host.textContent).not.toContain('去平台设置')
  })

  it('keeps the platform sentences in the ⓘ of the rows they explain', async () => {
    const { host } = await mount({ webSearchSupported: false })
    const trigger = (fragment: string): HTMLButtonElement | undefined =>
      [...host.querySelectorAll<HTMLButtonElement>('button[aria-label]')]
        .find((button) => (button.getAttribute('aria-label') ?? '').includes(fragment))

    // 模型那一行的 ⓘ 说明「模型在平台设置里改」。
    const modelInfo = trigger('模型服务属于平台设置')
    expect(modelInfo).not.toBeUndefined()
    await act(async () => modelInfo!.click())
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(visiblePopoverText()).toContain('模型服务属于平台设置')

    // 补查方式那一行的 ⓘ 说明「搜索供应商在平台设置里改」。
    const providerInfo = trigger('网页搜索供应商属于平台设置')
    expect(providerInfo).not.toBeUndefined()
    await act(async () => providerInfo!.click())
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(visiblePopoverText()).toContain('网页搜索供应商属于平台设置')
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
    const retry = host.querySelector<HTMLButtonElement>('[data-inline-notice="danger"] .inline-notice__action')
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

describe('the AI block’s warnings are one banner each, with a real jump', () => {
  it('keeps the search-provider sentence on the caution banner and offers 去配置', async () => {
    const { host, last } = await mount({ webSearchSupported: false })
    // 打开「允许补查」再保存：没有可用搜索源 → 被拒绝并留一条阻塞状态。
    const webSearchSwitch = switches(host)[1]
    await act(async () => webSearchSwitch?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await act(async () => { last()?.save() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    const banners = [...host.querySelectorAll<HTMLElement>('[data-inline-notice="caution"]')]
    expect(banners).toHaveLength(1)
    // 指令句保留原文（它是状态 + 下一步动作，不是解释）。
    expect(banners[0]?.textContent).toContain('无法开启：请先在 设置 → 网页搜索 → 供应商 配置并启用搜索源。')
    const action = banners[0]?.querySelector<HTMLButtonElement>('.inline-notice__action')
    expect(action?.textContent).toBe('去配置')
    await act(async () => action!.click())
    expect(vi.mocked(openWebSearchSettings)).toHaveBeenCalledTimes(1)
  })

  it('offers 去网页搜索供应商 on the unsupported-model banner, and keeps 补查方式 as a row', async () => {
    const { host } = await mount({ webSearchSupported: false })
    const banners = [...host.querySelectorAll<HTMLElement>('[data-inline-notice="caution"]')]
    expect(banners).toHaveLength(1)
    expect(banners[0]?.textContent).toContain('当前模型不支持内置搜索，补查将走平台 Web Search')
    const action = banners[0]?.querySelector<HTMLButtonElement>('.inline-notice__action')
    expect(action?.textContent).toBe('去网页搜索供应商')
    await act(async () => action!.click())
    expect(vi.mocked(openWebSearchSettings)).toHaveBeenCalled()
    // 普通设置行照旧：补查方式 = 平台 Web Search（整句细节在它的 ⓘ 里）。
    expect(host.textContent).toContain('补查方式')
    expect(host.textContent).toContain('平台 Web Search')
    expect(host.textContent).not.toContain('需已启用搜索源')
  })

  it('marks read and write failures as danger banners, and keeps the retry inside', async () => {
    stubBridge()
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(
      <ShellLanguageProvider language="zh-CN"><ConfirmProvider><DailyBriefingSettingsPanel onState={() => undefined} /></ConfirmProvider></ShellLanguageProvider>
    ))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    // 期列表读失败：红色档横幅 + 横幅里的重试（读失败不是空态）。
    const invoke = (window as unknown as { platform: { products: { invoke: (...args: unknown[]) => Promise<unknown> } } }).platform.products
    invoke.invoke = vi.fn(async (_product: string, method: string) => {
      if (method === 'intelligence.dailyBriefing.listPeriods') throw new Error('list-failed')
      if (method === 'intelligence.dailyBriefing.getSettings') return aiView
      return undefined
    }) as never
    await act(async () => root!.unmount()); root = undefined; document.body.replaceChildren()
    const failed = document.createElement('div')
    document.body.append(failed)
    root = createRoot(failed)
    await act(async () => root!.render(
      <ShellLanguageProvider language="zh-CN"><ConfirmProvider><DailyBriefingSettingsPanel onState={() => undefined} /></ConfirmProvider></ShellLanguageProvider>
    ))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    const danger = failed.querySelector<HTMLElement>('[data-inline-notice="danger"]')
    expect(danger).not.toBeNull()
    expect(danger?.getAttribute('role')).toBe('alert')
    const retry = danger?.querySelector<HTMLButtonElement>('.inline-notice__action')
    expect(retry?.textContent).toBe('再读一次')
  })
})

describe('a period that did not save names itself on a danger notice', () => {
  /** 打开某期的编辑弹框并按保存，让一次期写入真的发生（失败由桥决定）。 */
  async function failOnePeriodWrite(host: HTMLElement): Promise<void> {
    await act(async () => host.querySelector<HTMLElement>('[data-period-edit="default"]')!.click())
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    const save = [...document.querySelectorAll<HTMLButtonElement>('.ant-modal button')]
      .find((button) => (button.textContent ?? '').replace(/\s+/gu, '') === '保存')
    expect(save).not.toBeUndefined()
    await act(async () => save!.click())
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  }

  it('renders the failure as the shared danger notice, with the sentence naming the period', async () => {
    const { host } = await mount({ periodWriteRejects: true })
    await failOnePeriodWrite(host)

    const notices = [...host.querySelectorAll<HTMLElement>('[data-inline-notice="danger"]')]
    expect(notices).toHaveLength(1)
    expect(notices[0]?.getAttribute('role')).toBe('alert')
    expect(notices[0]?.textContent).toContain('这一期没存上，再试一次。')
    // 没有裸 <p role="alert"> 兜底：警示一律走提示条（颜色由档位给，不是自己画的）。
    expect(host.querySelectorAll('p[role="alert"]')).toHaveLength(0)
  })

  it('leaves the single sentence to the drawer when both would speak at once', async () => {
    const { host, last } = await mount({ periodWriteRejects: true, saveFails: true })
    await failOnePeriodWrite(host)
    expect(host.textContent).toContain('这一期没存上，再试一次。')

    // 再让 AI 编辑这一次保存也失败：壳在动作栏上方有一条更全局的句子，区块级的那条让位。
    await act(async () => switches(host)[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await act(async () => { last()?.save() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    expect(last()?.failure).toContain('AI 编辑未保存')
    expect(host.textContent).not.toContain('这一期没存上，再试一次。')
  })
})

describe('focus.briefing.section', () => {
  it('brings the named block into view once, even though it arrives after the first paint', async () => {
    // AI 那一块要读到草稿才画得出来：只在挂载时试一次的话，锚点那时还不存在，会一声不响地不定位。
    const scroll = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scroll })
    try {
      const { host } = await mount({}, 'ai')
      expect(scroll).toHaveBeenCalledTimes(1)
      const marked = [...host.querySelectorAll<HTMLElement>('[data-focused="true"]')]
      expect(marked).toHaveLength(1)
      expect(marked[0]?.getAttribute('data-briefing-section')).toBe('ai')
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })

  it('leaves the reader alone when no section was asked for', async () => {
    const scroll = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scroll })
    try {
      const { host } = await mount()
      expect(scroll).not.toHaveBeenCalled()
      expect(host.querySelector('[data-focused]')).toBeNull()
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })
})
