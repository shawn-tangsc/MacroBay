// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { CryptoIntelligenceDashboard } from './CryptoIntelligenceDashboard'
import { MARKET_ANALYSIS_COMPACT_MAX_WIDTH, MARKET_ANALYSIS_DRAWER, MarketAnalysisDashboardLayout } from './MarketAnalysisDashboardLayout'

/**
 * pad 竖屏：看板是底盘，会话入口常驻右下（用户 2026-11-24 拍板，原型
 * `docs-private/05-desktop/ui-audit/prototypes/2026-11-24-pad-agent-drawer.html`）。
 *
 * 这一组钉的是**入口在哪儿、会不会被藏起来**——不是样式细节：
 * ① 那排「市场看板 / 数字货币解读」切换已经撤掉，没有东西能把看板换走；
 * ② 会话圆钮挂在布局根上，不在 agent 栏里（窄档那栏是隐藏的，挂进去就等于没有入口）。
 */
const portal = productText['zh-CN'].pages.intelligence.portal
const asOf = '2026-10-07T09:06:14.792Z'
let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const never = async () => ({ state: 'unavailable' })
const dashboardProps = {
  text: portal.dashboard,
  client: { queryMonth: never } as never,
  fundingRateClient: { query: never } as never,
  now: () => new Date(asOf),
  onBack: () => {},
  onConfigureSources: () => {},
  onManageSource: () => {},
  onOpenCalendar: () => {}
}

function stubPlatform(): void {
  const invoke = vi.fn(async (_product: string, method: string) => {
    if (method === 'marketAnalysis.getSettings') return { enabled: false, providerId: '', modelId: '', updatedAt: asOf }
    if (method === 'marketAnalysis.listTimeline') return { schemaVersion: 1, nextCursor: null, items: [] }
    if (method === 'marketAnalysis.getLatestAttempt') return null
    return []
  })
  vi.stubGlobal('platform', {
    products: { invoke },
    settings: { get: async () => ({ modelDefaults: {} }) },
    agents: { getState: async () => ({ agents: [], sessions: [], messagesBySessionId: {} }), onStateChanged: () => () => {} }
  })
}

async function mount(): Promise<HTMLElement> {
  stubPlatform()
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(MarketAnalysisDashboardLayout, {
      text: portal,
      children: createElement(CryptoIntelligenceDashboard, { ...dashboardProps } as never)
    }))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return container
}

/**
 * 窄档：布局根量出来的宽度就是 pad 竖屏那一档。
 *
 * 判窄靠 `ResizeObserver` 量布局根（与 CSS 容器查询同一个量），happy-dom 不带它，
 * 所以给一个「观察时立刻回调」的替身，宽度由用例给。
 */
function stubWidth(width: number): void {
  vi.stubGlobal('ResizeObserver', class {
    private readonly callback: ResizeObserverCallback
    constructor(callback: ResizeObserverCallback) { this.callback = callback }
    observe(): void {
      this.callback([{ contentRect: { width } }] as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver)
    }
    unobserve(): void {}
    disconnect(): void {}
  })
}

async function mountNarrow(width = 908): Promise<HTMLElement> {
  stubWidth(width)
  return mount()
}

describe('pad 竖屏的会话入口', () => {
  it('没有「市场看板 / 数字货币解读」切换行，看板换不走', async () => {
    const container = await mount()
    expect(container.querySelector('.mi-analysis-dashboard-layout__switch')).toBeNull()
    // 撤干净了：样式表里也不该再留着这一行（留着就会被下一个人当回退路径加回来）。
    const css = readFileSync(join(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/marketAnalysisWorkspace.css'), 'utf8')
    expect(css).not.toContain('.mi-analysis-dashboard-layout__switch')
    const narrow = css.slice(css.indexOf('@container mi-analysis-dashboard (max-width: 1303px)'))
    expect(narrow).toContain('.mi-analysis-agent-workspace { display: none; }')
  })

  it('会话圆钮挂在布局根上，不在窄档会被隐藏的 agent 栏里', async () => {
    const container = await mount()
    const button = container.querySelector('[data-agent-floating-button]')
    expect(button).not.toBeNull()
    const host = container.querySelector('[data-agent-control-host]')
    expect(host).not.toBeNull()
    expect(host!.contains(button!)).toBe(true)
    // 窄档那一栏整体隐藏（只是隐藏、不卸载）；圆钮挂在里面就永远看不见。
    expect(container.querySelector('.mi-analysis-agent-workspace')?.contains(button!)).toBe(false)
    expect(button!.getAttribute('aria-expanded')).toBe('false')
  })
})
it('量窄档用的数字，与样式表那条容器查询同值', async () => {
  // 两个来源会漂：CSS 改了数、JS 还按老数切，抽屉就出现在「两栏其实已经并排」的宽度上。
  const css = readFileSync(join(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/marketAnalysisWorkspace.css'), 'utf8')
  const cssMax = Number(/@container mi-analysis-dashboard \(max-width: (\d+)px\)/.exec(css)?.[1])
  expect(cssMax).toBeGreaterThan(0)
  expect(MARKET_ANALYSIS_COMPACT_MAX_WIDTH).toBe(cssMax)
})

/**
 * 窄档圆钮的真位置（界面设计 2026-11-24 复签第 ④ 条）。
 *
 * 这一支没有拖拽，所以它不该用「挂载那一刻算出来的像素坐标」：转屏、改窗口就离开右下。
 * 位置交给 CSS 的 `right/bottom`（同一条 16）——坐标只留给可拖的宽档。
 */
it('窄档圆钮钉在右下：不写像素坐标，交给 right/bottom 16', async () => {
  const container = await mountNarrow()
  const button = container.querySelector<HTMLButtonElement>('[data-agent-floating-button]')!
  expect(button.hasAttribute('data-compact')).toBe(true)
  expect(button.style.left).toBe('')
  expect(button.style.top).toBe('')
  const css = readFileSync(join(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/marketAnalysisWorkspace.css'), 'utf8')
  const rule = css.slice(css.indexOf('.mi-agent-floating__button[data-compact]'), css.indexOf('\n}', css.indexOf('.mi-agent-floating__button[data-compact]')) + 2)
  expect(rule).toContain('right: 16px')
  expect(rule).toContain('bottom: 16px')
  expect(rule).toContain('left: auto')
  expect(rule).toContain('top: auto')
})

it('首帧就落窄档：没有 ResizeObserver 也不按宽档画一帧', async () => {
  // 只给同步量（`getBoundingClientRect`），不留 ResizeObserver：等它回调就已经按宽档画过一帧，
  // 窄屏上会闪一下再跳回右下。
  vi.stubGlobal('ResizeObserver', undefined)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 908, height: 1440, top: 0, left: 0, right: 908, bottom: 1440, x: 0, y: 0, toJSON: () => ({})
  } as DOMRect)
  const container = await mount()
  expect(container.querySelector('[data-agent-floating-button]')?.hasAttribute('data-compact')).toBe(true)
})

/**
 * 抽屉开着时看板那一层不可聚焦（界面设计 2026-11-24 复签第 1 条）。
 *
 * 机制是 `inert`，不是遮罩的指针遮挡：遮罩管的是指针与视觉，键盘 Tab 是另一件事。
 * 两条判据：① 开着时整层 inert（行为上：里面的元素 focus 拿不到焦点）；② 关掉后撤掉、焦点回得去。
 */
describe('抽屉开着时看板那一层不可聚焦', () => {
  const openSheet = async (container: HTMLElement) => {
    await act(async () => container.querySelector<HTMLButtonElement>('[data-agent-floating-button]')!.click())
  }

  it('开着时看板整层 inert，焦点进不去；抽屉自己还能操作', async () => {
    const container = await mountNarrow()
    const panes = container.querySelector<HTMLElement>('.mi-analysis-dashboard-layout__panes')!
    expect(panes.hasAttribute('inert')).toBe(false)
    await openSheet(container)
    expect(panes.hasAttribute('inert')).toBe(true)
    // 行为判据：这一层里的可聚焦元素拿不到焦点（`inert` 一管就够，不靠遮罩挡住指针）。
    const probe = document.createElement('button')
    panes.append(probe)
    probe.focus()
    expect(document.activeElement).not.toBe(probe)
    // 抽屉不在这一层里：它自己仍可操作，打开时焦点落在它的关闭上。
    const sheet = container.querySelector<HTMLElement>('[data-agent-sheet]')!
    expect(sheet.getAttribute('data-open')).toBe('true')
    expect(panes.contains(sheet)).toBe(false)
    expect(document.activeElement).toBe(sheet.querySelector('.icon-button'))
  })

  it('关掉之后 inert 撤掉，焦点能回到看板', async () => {
    const container = await mountNarrow()
    const panes = container.querySelector<HTMLElement>('.mi-analysis-dashboard-layout__panes')!
    const probe = document.createElement('button')
    panes.append(probe)
    await openSheet(container)
    expect(panes.hasAttribute('inert')).toBe(true)
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(panes.hasAttribute('inert')).toBe(false)
    probe.focus()
    expect(document.activeElement).toBe(probe)
  })
})

/**
 * v3 的两个面（用户 2026-11-24 拍板，`2026-11-24-pad-edge-handle-v3.md`）：
 * 左抽屉＝最新 AI 结论 + 重点舆情；底部聊天框＝对话 + 输入 + 一条「选中事件」。互斥。
 *
 * 两档：容器 ≥900 并排（看板让位 340，908 → 568，遮 0 个内容像素）；<900 整幅遮盖（等于切视图）。
 * 靠哪一边由 `MARKET_ANALYSIS_DRAWER.edge` 一处决定，样式按 `data-edge` 挂两套。
 */
describe('pad 竖屏 v3：左抽屉 + 底部聊天框', () => {
  const drawer = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-analysis-drawer]')!
  const grip = (container: HTMLElement) => container.querySelector<HTMLButtonElement>('.mi-analysis-drawer__grip')!
  const panes = (container: HTMLElement) => container.querySelector<HTMLElement>('.mi-analysis-dashboard-layout__panes')!
  const scrim = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-analysis-drawer-scrim]')!
  const readCss = () => readFileSync(join(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/marketAnalysisWorkspace.css'), 'utf8')

  it('960 档：抽屉并排，看板让位 340 剩 568，遮 0 个内容像素', async () => {
    const container = await mountNarrow(908)
    await act(async () => grip(container).click())
    expect(drawer(container).getAttribute('data-open')).toBe('true')
    expect(drawer(container).getAttribute('data-tier')).toBe('side')
    // 并排档是「让位」不是「覆盖」：没有遮罩、看板不 inert。
    expect(panes(container).getAttribute('data-drawer')).toBe('side')
    expect(container.querySelector('[data-analysis-drawer-scrim]')).toBeNull()
    expect(panes(container).hasAttribute('inert')).toBe(false)
    // 抽屉在右缘：圆钮（右下角）正好压在抽屉上，所以开着时不渲染——同一块面上不留两颗入口。
    expect(container.querySelector('[data-agent-floating-button]')).toBeNull()
    // 数：908 − 340 = 568。
    expect(908 - MARKET_ANALYSIS_DRAWER.width).toBe(568)
    const css = readCss()
    expect(css).toContain(`--mi-analysis-drawer-width: ${MARKET_ANALYSIS_DRAWER.width}px`)
    expect(css).toContain(".mi-analysis-dashboard-layout__panes[data-drawer='side'][data-edge='right'] { margin-right: var(--mi-analysis-drawer-width); }")
  })

  it('800 档：整幅遮盖（等于切视图），看板 inert、圆钮不渲染', async () => {
    const container = await mountNarrow(748)
    expect(drawer(container).getAttribute('data-tier')).toBe('full')
    await act(async () => grip(container).click())
    expect(drawer(container).getAttribute('data-open')).toBe('true')
    // 整幅档是模态：有遮罩、看板不可聚焦、圆钮撤掉（它 z 比遮罩高，压上去就是第二层入口）。
    expect(container.querySelector('[data-analysis-drawer-scrim]')).not.toBeNull()
    expect(panes(container).hasAttribute('inert')).toBe(true)
    expect(container.querySelector('[data-agent-floating-button]')).toBeNull()
    expect(readCss()).toContain(".mi-analysis-drawer[data-tier='full'] { width: 100%; box-shadow: none; }")
  })

  it('两个面互斥：开一个关另一个（不卸载，草稿与滚动位置都留着）', async () => {
    const container = await mountNarrow(908)
    // 先开聊天框，再点把手开抽屉：聊天框自己关掉。
    await act(async () => container.querySelector<HTMLButtonElement>('[data-agent-floating-button]')!.click())
    expect(container.querySelector('[data-agent-sheet]')?.getAttribute('data-open')).toBe('true')
    await act(async () => grip(container).click())
    expect(drawer(container).getAttribute('data-open')).toBe('true')
    expect(container.querySelector('[data-agent-sheet]')?.getAttribute('data-open')).toBe('false')
    // 关掉只是不可见：两个面都还在树上，没被卸载（草稿、舆情滚动位置都留着）。
    expect(drawer(container)).not.toBeNull()
    expect(container.querySelector('[data-agent-sheet]')).not.toBeNull()
  })

  it('抽屉里是「最新 AI 结论 + 重点舆情」，聊天框里是对话 + 一条「选中事件」', async () => {
    const container = await mountNarrow(908)
    await act(async () => grip(container).click())
    // AI 结论：卡带着「查看完整结论」进时间线的入口。
    const card = drawer(container).querySelector('.mi-analysis-conclusion-card')
    expect(card).not.toBeNull()
    // 重点舆情：同一个节点从 agent 栏搬过来（不是复制一份）。
    expect(drawer(container).querySelector('.mi-news-sentiment')).not.toBeNull()
    expect(container.querySelectorAll('.mi-news-sentiment')).toHaveLength(1)
    // 对话不在抽屉里，舆情也不在聊天框里。
    expect(drawer(container).querySelector('.mi-analysis-chat')).toBeNull()
    // 抽屉在右缘时圆钮不渲染：先关抽屉，再开聊天框看它里面装的是什么。
    await act(async () => drawer(container).querySelector<HTMLButtonElement>('.icon-button')!.click())
    await act(async () => container.querySelector<HTMLButtonElement>('[data-agent-floating-button]')!.click())
    const sheet = container.querySelector('[data-agent-sheet]')!
    expect(sheet.querySelector('.mi-analysis-chat')).not.toBeNull()
    expect(sheet.querySelector('.mi-news-sentiment')).toBeNull()
    // 「选中事件」那一条只有一行：它在对话卡的第一行。
    expect(sheet.querySelectorAll('.mi-analysis-chat__binding')).toHaveLength(1)
  })

  it('X / Esc / 遮罩三路都能关，关掉后焦点回把手', async () => {
    // X
    const viaX = await mountNarrow(908)
    await act(async () => grip(viaX).click())
    await act(async () => drawer(viaX).querySelector<HTMLButtonElement>('.icon-button')!.click())
    expect(drawer(viaX).getAttribute('data-open')).toBe('false')
    expect(document.activeElement).toBe(grip(viaX))
    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()
    // Esc
    const viaEsc = await mountNarrow(908)
    await act(async () => grip(viaEsc).click())
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(drawer(viaEsc).getAttribute('data-open')).toBe('false')
    expect(document.activeElement).toBe(grip(viaEsc))
    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()
    // 整幅档点遮罩
    const viaScrim = await mountNarrow(748)
    await act(async () => grip(viaScrim).click())
    await act(async () => scrim(viaScrim).click())
    expect(drawer(viaScrim).getAttribute('data-open')).toBe('false')
    expect(document.activeElement).toBe(grip(viaScrim))
  })

  it('靠哪一边只由一处常量决定，样式左右两套都在', async () => {
    // 用户 2026-11-24 改口：从右边出来、往左推。翻边只改这一处。
    expect(MARKET_ANALYSIS_DRAWER.edge).toBe('right')
    const css = readCss()
    // 两个边都有规则：翻边只改常量，不用再改样式。
    expect(css).toContain(".mi-analysis-drawer[data-edge='left'] { left: 0;")
    expect(css).toContain(".mi-analysis-drawer[data-edge='right'] { right: 0;")
    expect(css).toContain(".mi-analysis-dashboard-layout__panes[data-drawer='side'][data-edge='right'] { margin-right: var(--mi-analysis-drawer-width); }")
    // 并排阈值：容器 ≥900 才并排（908 是 960 窗口的内容宽）。
    expect(MARKET_ANALYSIS_DRAWER.sideMinWidth).toBe(900)
    const container = await mountNarrow(908)
    expect(drawer(container).getAttribute('data-edge')).toBe('right')
    expect(grip(container).getAttribute('data-edge')).toBe('right')
  })
})
