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

function stubPlatform(newsItems: readonly unknown[] = []): void {
  const invoke = vi.fn(async (_product: string, method: string) => {
    if (method === 'marketAnalysis.getSettings') return { enabled: false, providerId: '', modelId: '', updatedAt: asOf }
    if (method === 'marketAnalysis.listTimeline') return { schemaVersion: 1, nextCursor: null, items: [] }
    if (method === 'marketAnalysis.getLatestAttempt') return null
    if (method === 'intelligence.getNewsSentiment') {
      return { state: newsItems.length > 0 ? 'available' : 'empty', asOf, generatedAt: asOf, window: '24h', items: newsItems, caveats: [] }
    }
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
 * 窄档的入口是**底部居中胶囊**（用户 2026-11-24 定：圆形悬浮钮在窄档撤掉）。
 *
 * 24 的 `IconButton` 外套 8px 内距 → 外径约 40，距底 12、水平居中、带阴影。
 * 只换形态不换语意：可访问名仍是「打开分析对话」。宽档那颗可拖圆钮与浮窗面板一行不改。
 */
it('窄档底部是一颗居中胶囊，不是右下圆形钮', async () => {
  const container = await mountNarrow()
  const capsule = container.querySelector<HTMLElement>('.mi-agent-capsule')!
  expect(capsule).not.toBeNull()
  const button = capsule.querySelector<HTMLButtonElement>('[data-agent-floating-button]')!
  expect(button.getAttribute('aria-label')).toBe(portal.analysisWorkspace.openChat)
  // 小胶囊里没有圆形悬浮钮（那是宽档的形态）。
  expect(container.querySelector('.mi-agent-floating__button[data-compact]')).toBeNull()
  const css = readFileSync(join(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/marketAnalysisWorkspace.css'), 'utf8')
  const rule = css.slice(css.indexOf('.mi-agent-capsule {'), css.indexOf('\n}', css.indexOf('.mi-agent-capsule {')) + 2)
  expect(rule).toContain('bottom: 12px')
  expect(rule).toContain('left: 50%')
  expect(rule).toContain('padding: 8px')
  expect(rule).toContain('border-radius: 999px')
  // 与两个面一样压在 antd 1000 之下，否则从图标栏打开设置抽屉会被它盖住。
  expect(rule).toContain('z-index: 990')
  // 窄档看板整个滚动容器留 56 底部内距：任何卡滚到底都不被胶囊压住。
  expect(css).toContain('.mi-analysis-dashboard-layout[data-compact] .mi-analysis-dashboard-layout__dashboard { padding-bottom: 56px; }')
})

it('首帧就落窄档：没有 ResizeObserver 也不按宽档画一帧', async () => {
  // 只给同步量（`getBoundingClientRect`），不留 ResizeObserver：等它回调就已经按宽档画过一帧。
  vi.stubGlobal('ResizeObserver', undefined)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 908, height: 1440, top: 0, left: 0, right: 908, bottom: 1440, x: 0, y: 0, toJSON: () => ({})
  } as DOMRect)
  const container = await mount()
  expect(container.querySelector('.mi-agent-capsule')).not.toBeNull()
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
  const grip = (container: HTMLElement) => container.querySelector<HTMLButtonElement>('.mi-agent-drawer__grip')!
  const panes = (container: HTMLElement) => container.querySelector<HTMLElement>('.mi-analysis-dashboard-layout__panes')!
  const scrim = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-analysis-drawer-scrim]')!
  const readCss = () => readFileSync(join(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/marketAnalysisWorkspace.css'), 'utf8')

  it('960 档：抽屉**覆盖**在右缘，看板不重排（用户 2026-11-24 真机纠正）', async () => {
    const container = await mountNarrow(908)
    await act(async () => grip(container).click())
    expect(drawer(container).getAttribute('data-open')).toBe('true')
    expect(drawer(container).getAttribute('data-tier')).toBe('side')
    // 并排档没有遮罩、看板不 inert：抽屉只盖住右边那一条，左侧仍可见可读。
    expect(container.querySelector('[data-analysis-drawer-scrim]')).toBeNull()
    expect(panes(container).hasAttribute('inert')).toBe(false)
    const css = readCss()
    // 至少半屏（固定 340 太窄）；窄于 420 就全宽。仍是覆盖，不是挤压。
    expect(css).toContain('--mi-analysis-drawer-width: 420px')
    expect(css).toContain(".mi-agent-drawer[data-tier='side'] { width: max(50%, var(--mi-analysis-drawer-width)); }")
    // **覆盖不是让位**：两条 margin 让位规则已经删掉，看板保持原宽度。
    expect(css).not.toContain('margin-left: var(--mi-analysis-drawer-width)')
    expect(css).not.toContain('margin-right: var(--mi-analysis-drawer-width)')
    expect(css).toContain(".mi-agent-drawer[data-edge='right'] { right: 0; left: auto;")
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
    expect(readCss()).toContain(".mi-agent-drawer[data-tier='full'] { width: 100%; box-shadow: none; }")
  })

  it('整幅档开着时左侧图标栏也 inert（并排档不关，导航要能用）', async () => {
    const rail = document.createElement('aside')
    rail.className = 'global-sidebar'
    document.body.append(rail)
    // 并排档：看板要能读、导航也要能用。
    const side = await mountNarrow(908)
    await act(async () => grip(side).click())
    expect(rail.hasAttribute('inert')).toBe(false)
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()
    document.body.append(rail)
    // 整幅档＝切到这一屏：图标栏不在布局根里、也盖不到，只能从外面关掉。
    const full = await mountNarrow(748)
    await act(async () => grip(full).click())
    expect(rail.hasAttribute('inert')).toBe(true)
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(rail.hasAttribute('inert')).toBe(false)
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

  it('X / Esc 两路都能关，关掉后焦点回把手；遮罩没有关闭动作', async () => {
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
    // 「点遮罩关」这条路不存在：抽屉 `width:100%` 且 z 更高，压在遮罩上，点了也点不到。
    // 所以遮罩不带 onClick——两档统一只有 X 与 Esc 两条关闭路。
    const viaScrim = await mountNarrow(748)
    await act(async () => grip(viaScrim).click())
    expect(drawer(viaScrim).getAttribute('data-open')).toBe('true')
    await act(async () => scrim(viaScrim).click())
    expect(drawer(viaScrim).getAttribute('data-open')).toBe('true')
  })

  it('靠哪一边只由一处常量决定，样式左右两套都在', async () => {
    // 用户 2026-11-24 改口：从右边出来、往左推。翻边只改这一处。
    expect(MARKET_ANALYSIS_DRAWER.edge).toBe('right')
    const css = readCss()
    // 两个边都有规则：翻边只改常量，不用再改样式。
    expect(css).toContain(".mi-agent-drawer[data-edge='left'] { left: 0;")
    expect(css).toContain(".mi-agent-drawer[data-edge='right'] { right: 0;")
    // 翻边只改常量：右缘那条规则的边框/阴影也按 data-edge 走，没有第二处写死。
    expect(css).toContain(".mi-agent-drawer[data-edge='right'] { right: 0; left: auto;")
    // 并排阈值：容器 ≥900 才并排（908 是 960 窗口的内容宽）。
    expect(MARKET_ANALYSIS_DRAWER.sideMinWidth).toBe(900)
    const container = await mountNarrow(908)
    expect(drawer(container).getAttribute('data-edge')).toBe('right')
    expect(grip(container).getAttribute('data-edge')).toBe('right')
  })
})

/**
 * 宿主开的模态层要能把「圆钮不渲染」传下来（v3 复核第 ② 条）。
 *
 * 圆钮 z=1100，antd 抽屉 1000：不传就是压在模态层上的第二层入口。状态由**开抽屉的人**报上来，
 * 布局不猜 DOM 里有没有 `.ant-drawer`。
 */
describe('宿主模态层与圆钮', () => {
  it('看板报「我开着模态抽屉」，圆钮就撤掉', async () => {
    stubPlatform()
    // 窄档才有「圆钮压模态层」这回事：宽档的浮窗面板不是模态，圆钮照旧常驻。
    stubWidth(908)
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    // 用最小子组件扮演看板：它知道自己的抽屉开没开，把状态报上来。
    function ModalChild({ onModalLayerChange }: { onModalLayerChange?: (open: boolean) => void }) {
      return createElement('button', { 'data-open-modal': '', onClick: () => onModalLayerChange?.(true) }, 'open')
    }
    await act(async () => { root?.render(createElement(MarketAnalysisDashboardLayout, { text: portal, children: createElement(ModalChild) })) })
    expect(container.querySelector('[data-agent-floating-button]')).not.toBeNull()
    await act(async () => container.querySelector<HTMLButtonElement>('[data-open-modal]')!.click())
    expect(container.querySelector('[data-agent-floating-button]')).toBeNull()
  })

  it('看板把「设置 / 关键指标 / 政策详情」三层并起来报，不去 DOM 里猜', async () => {
    // 为什么用源码断言：把真实设置抽屉打开会连带挂载四屏设置面板（各自要真实读口），
    // 这条要钉的是「三层状态并成一个、报给宿主」这个结构事实，不是那四屏怎么画。
    const source = readFileSync(join(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/CryptoIntelligenceDashboard.tsx'), 'utf8')
    expect(source).toContain('const dashboardModalOpen = settingsDrawerOpen || indicatorDrawerOpen || policyDrawer.open')
    expect(source).toContain('onModalLayerChange?.(dashboardModalOpen)')
    // 不许改成「看 DOM 里有没有 .ant-drawer」：那是猜，抽屉还没挂上来时就漏。
    expect(source).not.toContain("querySelector('.ant-drawer")
  })
})

/**
 * v4 拖动：右缘起拖条（0–24 全高，刨掉圆钮 56×56）＋ 界面其余地方（> 8px 且 ≥ 1.5 × 竖直）
 * ＋ 跟手 1:1 ＋ 吸附线 = 抽屉宽 ÷ 3（并排 114、整幅 250）。
 *
 * 判据在 `analysisDrawerDrag.ts`（纯函数），这里钉的是「接上之后行为对不对」。
 * 舞台矩形用 908（960 窗口的内容宽）/ 748（800 窗口）两档；圆钮是 `position: fixed`，
 * 命中矩形按视口算：right 16 / bottom 88 / 56×56。
 */
describe('v4 拖动：起拖条、跟手与吸附', () => {
  const drawerEl = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-analysis-drawer]')!
  const rootEl = (container: HTMLElement) => container.querySelector<HTMLElement>('.mi-analysis-dashboard-layout')!

  function stubStage(width: number, height = 1440): void {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0, toJSON: () => ({})
    } as DOMRect)
  }
  const pointer = (type: string, clientX: number, clientY: number) =>
    Object.assign(new Event(type, { bubbles: true, cancelable: true }), { clientX, clientY, pointerId: 1, button: 0 })
  const press = async (container: HTMLElement, x: number, y: number) => {
    await act(async () => { rootEl(container).dispatchEvent(pointer('pointerdown', x, y)) })
  }
  const moveTo = async (x: number, y: number) => {
    await act(async () => { window.dispatchEvent(pointer('pointermove', x, y)) })
  }
  const release = async () => {
    await act(async () => { window.dispatchEvent(pointer('pointerup', 0, 0)) })
  }

  it('右缘起拖：左移 100 跟手 1:1，松手不到吸附线回弹', async () => {
    stubStage(908)
    const container = await mountNarrow(908)
    expect(drawerEl(container).getAttribute('data-open')).toBe('false')
    await press(container, 900, 400)   // 908 − 900 = 8 ≤ 24：起拖条
    await moveTo(800, 400)             // 左移 100
    expect(drawerEl(container).getAttribute('data-drag')).toBe('true')
    expect(drawerEl(container).style.transform).toBe('translateX(-100px)')
    await release()
    // 100 < 454 ÷ 3 = 151.33：回弹收起，带 160ms 过渡。
    expect(drawerEl(container).getAttribute('data-open')).toBe('false')
    expect(drawerEl(container).getAttribute('data-settling')).toBe('true')
  })

  it('松手 152 吸附展开、151 回弹（并排档：454 ÷ 3 = 151.33）', async () => {
    stubStage(908)
    const open = await mountNarrow(908)
    await press(open, 900, 400)
    await moveTo(748, 400)             // 左移 152 ≥ 151.33
    await release()
    expect(drawerEl(open).getAttribute('data-open')).toBe('true')
    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()
    const rebound = await mountNarrow(908)
    await press(rebound, 900, 400)
    await moveTo(749, 400)             // 左移 151 < 151.33
    await release()
    expect(drawerEl(rebound).getAttribute('data-open')).toBe('false')
  })

  it('整幅档的吸附线是页宽 ÷ 3：250 展开、249 回弹', async () => {
    stubStage(748)
    const open = await mountNarrow(748)
    expect(drawerEl(open).getAttribute('data-tier')).toBe('full')
    await press(open, 740, 400)        // 748 − 740 = 8 ≤ 24
    await moveTo(490, 400)             // 左移 250 ≥ 249.33
    await release()
    expect(drawerEl(open).getAttribute('data-open')).toBe('true')
    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()
    const rebound = await mountNarrow(748)
    await press(rebound, 740, 400)
    await moveTo(491, 400)             // 左移 249 < 249.33
    await release()
    expect(drawerEl(rebound).getAttribute('data-open')).toBe('false')
  })

  it('跟手位移夹在抽屉宽：拖 400 也只到 454（max(50%, 420)）', async () => {
    stubStage(908)
    const container = await mountNarrow(908)
    await press(container, 900, 400)
    await moveTo(500, 400)             // 左移 400
    expect(drawerEl(container).style.transform).toBe('translateX(-400px)')
    await moveTo(300, 400)             // 左移 600 → 夹到 454
    expect(drawerEl(container).style.transform).toBe('translateX(-454px)')
  })

  it('起拖条要左移 ≥ 4px：3px 不动', async () => {
    stubStage(908)
    const container = await mountNarrow(908)
    await press(container, 900, 400)
    await moveTo(897, 400)             // 左移 3
    expect(drawerEl(container).getAttribute('data-drag')).toBeNull()
    expect(drawerEl(container).style.transform).toBe('')
  })

  it('界面中部：横向 12 竖直 3 拉抽屉；横向 12 竖直 10 不拉、交给滚动', async () => {
    stubStage(908)
    const container = await mountNarrow(908)
    await press(container, 500, 300)   // 界面中部，不是起拖条
    await moveTo(488, 303)             // 12 > 8 且 12 ≥ 4.5
    expect(drawerEl(container).getAttribute('data-drag')).toBe('true')
    expect(drawerEl(container).style.transform).toBe('translateX(-12px)')
    await release()
    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()
    const vertical = await mountNarrow(908)
    await press(vertical, 500, 300)
    await moveTo(488, 310)             // 12 ≥ 15？不成立 → 不抢
    expect(drawerEl(vertical).getAttribute('data-drag')).toBeNull()
    expect(drawerEl(vertical).style.transform).toBe('')
  })

  it('按在圆钮上拖 200 不起拖，点它仍然开聊天框', async () => {
    stubStage(908)
    const container = await mountNarrow(908)
    // 胶囊命中矩形：水平居中 40、距底 12 → 视口 1024×768 下是 492..532 × 716..756。
    await press(container, 512, 730)
    await moveTo(312, 730)             // 拖 200
    expect(drawerEl(container).getAttribute('data-drag')).toBeNull()
    expect(drawerEl(container).getAttribute('data-open')).toBe('false')
    await act(async () => container.querySelector<HTMLButtonElement>('[data-agent-floating-button]')!.click())
    expect(container.querySelector('[data-agent-sheet]')?.getAttribute('data-open')).toBe('true')
  })

  it('聊天框开着时右缘拖 200 不动（两个面互斥，先关它）', async () => {
    stubStage(908)
    const container = await mountNarrow(908)
    await act(async () => container.querySelector<HTMLButtonElement>('[data-agent-floating-button]')!.click())
    await press(container, 900, 400)
    await moveTo(700, 400)
    expect(drawerEl(container).getAttribute('data-drag')).toBeNull()
    expect(drawerEl(container).getAttribute('data-open')).toBe('false')
  })

  it('拖动期间禁止选中文字、touch-action 是 pan-y，松手即撤', async () => {
    stubStage(908)
    const container = await mountNarrow(908)
    const root = rootEl(container)
    expect(root.style.userSelect).toBe('')
    await press(container, 900, 400)
    await moveTo(800, 400)
    expect(root.style.userSelect).toBe('none')
    expect(root.style.touchAction).toBe('pan-y')
    await release()
    expect(root.style.userSelect).toBe('')
    expect(root.style.touchAction).toBe('')
  })

  it('拖出后指针离开不收回：只有 X 与 Esc 能关', async () => {
    stubStage(908)
    const container = await mountNarrow(908)
    await press(container, 900, 400)
    await moveTo(700, 400)
    await release()
    expect(drawerEl(container).getAttribute('data-open')).toBe('true')
    await act(async () => { rootEl(container).dispatchEvent(new Event('pointerleave', { bubbles: true })) })
    expect(drawerEl(container).getAttribute('data-open')).toBe('true')
  })
})

/**
 * 抽屉里的舆情：**真实数据量**（用户给的是 7–12 条，不是两三条夹具）。
 *
 * 之前那一版「只有筛选按钮、下面一片空白」的根因是卡没有确定高度：卡内部的 `__drivers`
 * （`flex: 1; min-height: 0`）被压成 0。所以这条断的不是「渲染了」，而是**行数 = 数据条数**。
 */
it('抽屉里的舆情行数 = 数据条数（12 条，一条不少）', async () => {
  const items = Array.from({ length: 12 }, (_, index) => ({
    itemId: `item-${index}`,
    title: `舆情 ${index}`,
    sourceId: 'source-a',
    sourceName: '来源 A',
    publishedAt: asOf,
    scoredAt: asOf,
    polarity: 'neutral',
    strength: 3,
    confidence: 80,
    symbols: [],
    reasonCode: 'rule',
    engine: 'rules',
    caveats: []
  }))
  stubWidth(908)
  stubPlatform(items)
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
  await act(async () => container.querySelector<HTMLButtonElement>('.mi-agent-drawer__grip')!.click())
  const drawerNode = container.querySelector('[data-analysis-drawer]')!
  const rows = drawerNode.querySelectorAll('.mi-agent-drawer__news .mi-news-sentiment__drivers > button')
  expect(rows).toHaveLength(12)
})

/**
 * 触摸板两指横向滑（用户 2026-11-24）：往左滑弹出右侧抽屉，开着时反向滑收起。
 *
 * 只认横向为主（`|deltaX| > |deltaY| × 1.5`）、累计 40px、间隔 < 200ms 算同一段手势；
 * 到阈值那一发才 `preventDefault()`。
 */
describe('触摸板横向滑动开合', () => {
  const wheel = async (deltaX: number, deltaY: number) => {
    await act(async () => {
      window.dispatchEvent(Object.assign(new Event('wheel', { bubbles: true, cancelable: true }), { deltaX, deltaY }))
    })
  }
  const drawerOf = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-analysis-drawer]')!

  it('横 60 竖 0 → 打开', async () => {
    const container = await mountNarrow(908)
    expect(drawerOf(container).getAttribute('data-open')).toBe('false')
    await wheel(-60, 0)
    expect(drawerOf(container).getAttribute('data-open')).toBe('true')
  })

  it('横 30 竖 0 → 不动（累计没到 40）', async () => {
    const container = await mountNarrow(908)
    await wheel(-30, 0)
    expect(drawerOf(container).getAttribute('data-open')).toBe('false')
  })

  it('横 20 竖 20 → 不动（竖直为主，那是滚页面）', async () => {
    const container = await mountNarrow(908)
    await wheel(-20, 20)
    expect(drawerOf(container).getAttribute('data-open')).toBe('false')
  })

  it('竖 60 → 只滚页面，抽屉不动', async () => {
    const container = await mountNarrow(908)
    await wheel(0, 60)
    expect(drawerOf(container).getAttribute('data-open')).toBe('false')
  })

  it('横 -60 再横 -60（同一段手势）→ 只打开一次，不会来回切', async () => {
    const container = await mountNarrow(908)
    await wheel(-60, 0)
    expect(drawerOf(container).getAttribute('data-open')).toBe('true')
    await wheel(-60, 0)
    expect(drawerOf(container).getAttribute('data-open')).toBe('true')
  })

  it('开着时反向滑 60 → 关上', async () => {
    const container = await mountNarrow(908)
    await wheel(-60, 0)
    expect(drawerOf(container).getAttribute('data-open')).toBe('true')
    await wheel(60, 0)
    expect(drawerOf(container).getAttribute('data-open')).toBe('false')
  })
})
