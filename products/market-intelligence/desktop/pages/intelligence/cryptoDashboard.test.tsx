// @vitest-environment happy-dom
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import type { MacroMarketSnapshotView } from '../../../contracts/macro/macroMarketSnapshotContracts'
import type { MacroEconomicCalendarEventView } from '../../../contracts/macro/economicCalendarQueryContracts'
import { AgentPortal } from './AgentPortal'
import { CryptoIntelligenceDashboard as RawCryptoIntelligenceDashboard } from './CryptoIntelligenceDashboard'
import { dashboardFeedStatusPublicPolicy } from '../../../contracts/macro/dashboardFeedStatusContracts'

/** 测试里默认「所有源都已启用」：源状态是新的读取前提，不传就等于「读不到」，会把整套断言打乱。 */
const allSourcesEnabled = {
  query: async () => ({
    state: 'available' as const,
    sources: dashboardFeedStatusPublicPolicy.sourceIds.map(sourceId => ({ sourceId, enabled: true, hasCredential: true }))
  })
}
const CryptoIntelligenceDashboard = (props: Parameters<typeof RawCryptoIntelligenceDashboard>[0]): React.ReactElement =>
  createElement(RawCryptoIntelligenceDashboard, { dashboardFeedStatusClient: allSourcesEnabled, ...props })
import { marketIntelligenceAgents } from './agentPortalModel'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { formatShellInstant, resolveSystemTimeZone } from '@platform/ui/time/shellTimeFormat'
import { projectDashboardPositioning, projectPositioningSourceRow } from './dashboardOpenInterestModel'
import { dashboardCellId } from './dashboardCellEnabled'

const page = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/index.tsx'), 'utf8')
const portal = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/AgentPortal.tsx'), 'utf8')
const dashboard = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/CryptoIntelligenceDashboard.tsx'), 'utf8')
const styles = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/cryptoDashboard.css'), 'utf8')
/** The page stylesheet: it must not own the dashboard shell a second time. */
const pageStyles = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/intelligence.css'), 'utf8')
const asOf = '2026-08-05T00:00:00.000Z'
let root: Root | undefined


afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  if (typeof document !== 'undefined') document.body.replaceChildren()
})

function classCount(markup: string, className: string): number {
  return [...markup.matchAll(new RegExp(`class=\"[^\"]*${className}[^\"]*\"`, 'g'))].length
}

/** The ✓ summary line as the strip prints it: the count and the healthy feeds' own names. */
function formatFeedStatusSummary(template: string, count: number, names: readonly string[]): string {
  return template.replace('{count}', String(count)).replace('{names}', names.join(' · '))
}

function cssBlock(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker)
  const blockStart = source.indexOf('{', markerIndex)
  if (markerIndex < 0 || blockStart < 0) return ''

  let depth = 0
  for (let index = blockStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return source.slice(blockStart + 1, index)
  }

  return ''
}

describe('the old source drawer has no entry left', () => {
  it('sends every entry to the new drawer, through the one request builder', () => {
    // 入口都指向 `openConfigDrawer`，而「采集与数据」那几处的位置由 `sourcesDataRequestFor` 拼：
    // 六处（门户配置来源、样例「连数据」、日报页配置来源、看板行尾管理来源、日历设置、舆情设置）
    // 各自知道要落哪一项，但**请求形状只有一处**——`focus.menu` 漏了会被归一化当成不匹配丢掉定位，
    // 那种错在真机上只表现为「点了停在第一屏」。
    expect(page).not.toContain('setSourceDrawerOpen(true)')
    expect(page).not.toContain("openConfigDrawer('sourcesData', 'dashboard')")
    expect(page).not.toContain("openConfigDrawer('sourcesData', 'calendar')")
    expect(page.match(/sourcesDataRequestFor\(/g)?.length ?? 0).toBeGreaterThanOrEqual(6)
    // 日历那一颗显式说业务：不传就退回「看板」第一屏。
    expect(page).toContain("sourcesDataRequestFor({ business: 'calendar' })")
    // 位置来自调用方时原样转交（舆情 / 行尾「管理这个来源」）。
    expect(page.match(/sourcesDataRequestFor\(focus\)/g)?.length ?? 0).toBe(2)
  })

  it('no longer references the old drawer at all', () => {
    // 旧抽屉已经整块删掉（`24a0b4f`）：页面里连渲染语句都不该再有。这条从「恰好剩一处渲染」
    // 改成「0 处」——旧判据是删除完成前的过渡态，现在收紧。
    expect(page).not.toContain('DashboardPanelDrawer')
    expect(page).not.toContain('setSourceDrawerOpen')
  })
})

describe('crypto intelligence dashboard', () => {
  const text = productText['zh-CN'].pages.intelligence.portal

  /** One dashboard whose only meaningful panel input is the score, for the gauge-only cases. */
  async function renderSentimentGauge(score: number, bucket: 'extreme-fear' | 'fear' | 'neutral' | 'greed' | 'extreme-greed') {
    const container = document.createElement('div')
    document.body.append(container)
    const gaugeRoot = createRoot(container)
    await act(async () => gaugeRoot.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), fearGreedClient: fearGreedClient({
        state: 'available', asOf, score, bucket, observedAt: '2026-08-04T10:00:00.000Z'
      }), fundingRateClient: fundingRateClient(), openInterestClient: openInterestClient(), now: () => new Date(asOf),
      onConfigureSources: () => undefined, onManageSource: () => undefined,
      onOpenCalendar: () => undefined, text: text.dashboard
    })))
    await flush()
    return {
      gauge: container.querySelector<HTMLElement>('[data-sentiment-gauge]')!,
      dispose: async () => {
        await act(async () => gaugeRoot.unmount())
        container.remove()
      }
    }
  }

  it('keeps no styles for the retired dashboard source catalog', () => {
    // `.mi-dashboard-source-catalog*` 整组在 TSX/TS 里 **0 个节点**（属性 `data-source-enabled` 还活着，
    // 但它挂在 `source-provider-detail__row-state` 上，不在这组类里）。样式表里留着它，下一个人
    // 只会以为还有人在用——删掉，并用这条钉住它不许回来。
    expect(pageStyles).not.toContain('mi-dashboard-source-catalog')
  })

  it('removes static preview dependencies and leaves only real dashboard regions', () => {
    expect(page).not.toContain('cryptoDashboardPreview')
    expect(dashboard).not.toMatch(/CryptoDashboardPreview|cryptoMarketReadIds|cryptoCheckIds|market-read|judgment|macro-card|check-step|calendar-rule|staticPreview|notAdvice|__as-of|preview/)
    expect(styles).not.toMatch(/market-read|judgment|macro-card|check-step|calendar-rule|__caveat|__workspace|__sidebar/)
    for (const locale of ['zh-CN', 'en-US'] as const) {
      const dashboardText = productText[locale].pages.intelligence.portal.dashboard
      // `AS OF` is only a defect as a baked-in date — the static preview printed `AS OF 2026-08-01
      // 18:05`. The rate rows legitimately print an observation date, and their English template says
      // `(as of {date})` with the date filled in at render time. The guard still catches any literal
      // `AS OF <year>` while allowing the template's placeholder.
      expect(JSON.stringify(dashboardText)).not.toMatch(/static preview|静态预览|not trading advice|不构成投资建议|AS OF\s*\d{4}|2026-08-01 18:05/i)
    }
  })


  it('accepts localized dashboard text for the real capital and independent positioning panel', () => {
    const markup = renderToStaticMarkup(
      createElement(CryptoIntelligenceDashboard, {
        onConfigureSources: () => undefined,
        onManageSource: () => undefined,
        onOpenCalendar: () => undefined,
                client: dashboardClient(),
        fearGreedClient: fearGreedClient(), fundingRateClient: fundingRateClient(), openInterestClient: openInterestClient(),
        now: () => new Date(asOf),
        text: text.dashboard,
      })
    )

    expect(markup).toContain(text.dashboard.sentiment.title)
    // Three panel-owned rows, plus the 异常优先 feed strip: one ✓ summary line and one line per feed
    // that needs a look (the fixtures leave every feed without a readable reading).
    const sourceRows = [...markup.matchAll(/mi-crypto-dashboard__source-row/g)].length
    expect(markup).not.toContain('✓ 0 源正常')
    expect(markup).toContain(text.dashboard.positioning.title)
  })

  it('keeps both reading-note cards inside the scope that owns their type tokens', () => {
    // The reading-note type and cap are custom properties on `.mi-crypto-dashboard`, so they only
    // resolve inside that subtree. Move a card into a drawer or a dialog and `var()` resolves to
    // nothing: the size falls back to inherited type and the 320px cap disappears — a silent
    // layout break no other test would catch. No `var(--x, 11.5px)` fallback, on purpose: that
    // would put the number back in two places, which is what these tokens removed.
    const markup = renderToStaticMarkup(
      createElement(CryptoIntelligenceDashboard, {
        onConfigureSources: () => undefined,
        onManageSource: () => undefined,
        onOpenCalendar: () => undefined,
        client: dashboardClient(),
        fearGreedClient: fearGreedClient(), fundingRateClient: fundingRateClient(), openInterestClient: openInterestClient(),
        now: () => new Date(asOf),
        text: text.dashboard,
      })
    )
    const host = document.createElement('div')
    host.innerHTML = markup
    for (const selector of ['.mi-positioning-panel', '.mi-divergence']) {
      const panel = host.querySelector(selector)
      expect(panel, `${selector} must render in the dashboard`).not.toBeNull()
      expect(panel!.closest('.mi-crypto-dashboard'), `${selector} must sit inside .mi-crypto-dashboard`).not.toBeNull()
    }
    // And the numbers exist once, in that scope — a second declaration is a second drift point.
    for (const token of ['--mi-reading-note-size', '--mi-reading-note-line-height', '--mi-reading-note-max-height']) {
      expect(styles.match(new RegExp(`${token}:`, 'gu')), `${token} is declared once`).toHaveLength(1)
    }
    expect(cssBlock(styles, '.mi-crypto-dashboard {')).toContain('--mi-reading-note-size: 11.5px')
  })

  
  
  


  
  

  it('paints only a loading state on the frame before the enable map settles', async () => {
    // 用户真机两次白屏都发生在这帧：启用表/源状态还没回来时，组件只许画加载态——
    // 不画任何终态（未启用/读不到/空），也不留白。应用里这两个读口永远被注入；测试不注入就走不到这里。
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const pendingRead = () => new Promise<Record<string, boolean>>(() => undefined)
    const pendingSelection = () => new Promise<Record<string, string>>(() => undefined)
    await act(async () => root?.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), fearGreedClient: fearGreedClient(), fundingRateClient: fundingRateClient(),
      openInterestClient: openInterestClient(), now: () => new Date(asOf),
      cellEnabledIo: { read: pendingRead, readSelection: pendingSelection },
      dashboardFeedStatusClient: allSourcesEnabled,
      onConfigureSources: () => undefined, onManageSource: () => undefined, onOpenCalendar: () => undefined,
      text: text.dashboard
    })))
    await flush()

    expect(container.querySelector('[data-loading-state]')).not.toBeNull()
    expect(container.querySelector('[data-source-state]')).toBeNull()
    expect(container.querySelector('[data-state="disabled"], [data-state="error"]')).toBeNull()
    expect(container.querySelector('.mi-crypto-dashboard__capital-positioning-row')).not.toBeNull()
  })

  it.each([
    ['empty', { state: 'empty' as const, asOf }, 'empty'],
    ['unavailable', { state: 'unavailable' as const, failureCode: 'fear-greed-query-unavailable' as const }, 'unreadable']
  ] as const)('renders the %s sentiment read as its own state, not as the other one', async (_name, result, expected) => {
    // The gauge is the one place the reader sees risk appetite. "We could not read it" and "there
    // is no index yet" are different facts, and only one of them is the reader's fault to fix.
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), fearGreedClient: fearGreedClient(result), fundingRateClient: fundingRateClient(),
      openInterestClient: openInterestClient(), now: () => new Date(asOf),
      onConfigureSources: () => undefined, onManageSource: () => undefined, onOpenCalendar: () => undefined,
      text: text.dashboard
    })))
    await flush()

    const card = container.querySelector('.mi-crypto-dashboard__sentiment')!
    const row = card.querySelector('[data-sentiment-state]')!
    // 状态句在图下方那一行上（`data-sentiment-state`），不在图里；两态互斥，各说各的。
    expect(row.getAttribute('data-sentiment-state')).toBe(expected)
    expect(row.closest('[data-sentiment-gauge]')).toBeNull()
    expect(card.querySelector('[data-sentiment-gauge] [data-sentiment-state]')).toBeNull()
    // 两态之间不许互串：空的只说「暂无读数」，读不到只说「暂时读不到」（文案都来自 i18n 键）。
    expect(row.textContent).toContain(expected === 'empty' ? text.dashboard.fearGreed.empty : text.data.temporarilyUnavailable)
    expect(row.textContent).not.toContain(expected === 'empty' ? text.data.temporarilyUnavailable : text.dashboard.fearGreed.empty)
  })

  it('renders a textual half-gauge and independent BTC/ETH funding-history values', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => root?.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), fearGreedClient: fearGreedClient({
        state: 'available', asOf, score: 22, bucket: 'extreme-fear', observedAt: '2026-08-04T10:00:00.000Z'
      }), fundingRateClient: fundingRateClient({
        state: 'available', asOf,
        btc: [{ observedAt: '2026-08-04T10:00:00.000Z', ratePercent: 0.01234 }],
        eth: [{ observedAt: '2026-08-04T11:00:00.000Z', ratePercent: -0.0031 }]
      }), openInterestClient: openInterestClient(), now: () => new Date(asOf), onConfigureSources: () => undefined,
      onManageSource: () => undefined, onOpenCalendar: () => undefined, text: text.dashboard
    })))
    await flush()

    // Sentiment sits with the money rows: the reading order is 资金 → 风险偏好 → 杠杆.
    const row = container.querySelector('.mi-crypto-dashboard__capital-positioning-row')!
    const gauge = row.querySelector('[data-sentiment-gauge]')!
    expect(row.querySelector('.mi-capital-conditions')).not.toBeNull()
    expect(container.querySelector('.mi-crypto-dashboard__positioning-row [data-sentiment-gauge]')).toBeNull()
    const rows = container.querySelectorAll('.mi-crypto-dashboard__positioning-row [data-funding-latest]')
    const dial = gauge.querySelector('svg')!
    expect(dial.getAttribute('aria-hidden')).toBe('true')
    expect(dial.getAttribute('viewBox')).toBe('0 0 120 86')
    expect(gauge.querySelectorAll('[data-gauge-segment]')).toHaveLength(5)
    // The needle is its own path inside the mouth; the arc segments are never rotated as a whole.
    expect(gauge.querySelectorAll('[data-gauge-segment][transform]')).toHaveLength(0)
    expect(dial.querySelectorAll('.mi-crypto-dashboard__gauge-tick')).toHaveLength(5)
    const needle = dial.querySelector('.mi-crypto-dashboard__gauge-needle')!
    expect(needle.tagName.toLowerCase()).toBe('path')
    expect(needle.getAttribute('d')).toBe('M 60 43 L 60 18')
    expect(needle.getAttribute('data-gauge-bucket')).toBe('extreme-fear')
    expect(needle.parentElement?.getAttribute('transform')).toBe('rotate(-50.4 60 60)')
    // The readout is painted after the needle: it is the mask that keeps the blade out of the digits.
    const readout = dial.querySelector('.mi-crypto-dashboard__gauge-readout')!
    expect(readout.getAttribute('data-gauge-bucket')).toBe('extreme-fear')
    expect(readout.previousElementSibling).toBe(needle.parentElement)
    expect(gauge.querySelector('[data-gauge-bucket-text]')?.getAttribute('data-gauge-bucket-text')).toBe('extreme-fear')
    expect(gauge.textContent).toContain('22')
    expect(gauge.textContent).toContain(text.dashboard.fearGreed.buckets['extreme-fear'])
    expect(gauge.textContent).toContain(text.dashboard.fearGreed.observedAt)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('+0.0123%')
    expect(rows[0]?.textContent).toContain(text.dashboard.positioning.paymentDirections['long-pays-short'])
    expect(rows[1]?.textContent).toContain('-0.0031%')
    expect(rows[1]?.textContent).toContain(text.dashboard.positioning.paymentDirections['short-pays-long'])
    expect(row.textContent).not.toMatch(/58|conclusion|classification|https?:|sourceUrl|evidence|profile|health|credential|error/i)
  })

  it('points the needle left, straight up and right at the score extremes', async () => {
    for (const [score, bucket, transform] of [
      [0, 'extreme-fear', 'rotate(-90 60 60)'],
      [50, 'neutral', 'rotate(0 60 60)'],
      [100, 'extreme-greed', 'rotate(90 60 60)']
    ] as const) {
      const { gauge, dispose } = await renderSentimentGauge(score, bucket)
      expect(gauge.querySelector('.mi-crypto-dashboard__gauge-needle')?.getAttribute('data-gauge-bucket')).toBe(bucket)
      expect(gauge.querySelector('.mi-crypto-dashboard__gauge-needle')?.parentElement?.getAttribute('transform')).toBe(transform)
      expect(gauge.querySelector('[data-gauge-bucket-text]')?.getAttribute('data-gauge-bucket-text')).toBe(bucket)
      await dispose()
    }
  })

  it('keeps the needle and its bucket label on the same tone in all five bands', async () => {
    for (const [score, bucket] of [
      [12, 'extreme-fear'], [37, 'fear'], [50, 'neutral'], [60, 'greed'], [88, 'extreme-greed']
    ] as const) {
      const { gauge, dispose } = await renderSentimentGauge(score, bucket)
      expect(gauge.querySelector('.mi-crypto-dashboard__gauge-needle')?.getAttribute('data-gauge-bucket')).toBe(bucket)
      expect(gauge.querySelector('[data-gauge-bucket-text]')?.getAttribute('data-gauge-bucket-text')).toBe(bucket)
      await dispose()
    }
  })

  it('centres the score on the readout disc so the needle starts underneath it', () => {
    const scoreRule = cssBlock(styles, '.mi-crypto-dashboard__sentiment-dial strong {')
    const svgRule = cssBlock(styles, '.mi-crypto-dashboard__sentiment-gauge svg {')
    const needleRule = cssBlock(styles, '.mi-crypto-dashboard__gauge-needle {')
    const readoutRule = cssBlock(styles, '.mi-crypto-dashboard__gauge-readout {')

    expect(scoreRule).toContain('position: absolute')
    expect(scoreRule).toContain('top: 69.77%')
    expect(scoreRule).toContain('transform: translateY(-50%)')
    expect(scoreRule).toContain('font-size: 17px')
    expect(svgRule).toContain('height: 80px')
    expect(needleRule).toContain('stroke: var(--mi-dashboard-text)')
    expect(needleRule).toContain('stroke-width: 2.4')
    expect(needleRule).toContain('stroke-linecap: round')
    expect(needleRule).toContain('drop-shadow')
    expect(readoutRule).toContain('fill: var(--mi-dashboard-surface)')
    expect(styles).toContain('.mi-crypto-dashboard__gauge-tick { stroke: var(--mi-dashboard-text)')
    expect(styles).toContain('--mi-gauge-glow: var(--mi-dashboard-sentiment-extreme-fear)')
  })

  it('fails closed instead of crashing when a legacy funding client has no history query', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => root?.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), fearGreedClient: fearGreedClient(),
      openInterestClient: openInterestClient(),
      fundingRateClient: { querySnapshot: () => Promise.resolve({ state: 'empty' }) }, now: () => new Date(asOf),
      onConfigureSources: () => undefined, onManageSource: () => undefined,
      onOpenCalendar: () => undefined, text: text.dashboard
    } as never)))
    await flush()

    expect(container.querySelector('.mi-positioning-panel')?.getAttribute('data-funding-state')).toBe('unavailable')
  })

  it.each([
    ['loading', undefined, 'loading'],
    ['empty', { state: 'empty', asOf }, 'empty'],
    ['unavailable', { state: 'unavailable', failureCode: 'funding-rate-history-query-unavailable' }, 'unavailable'],
    // One leg with rows is `partial`, not `available`: the card draws that leg and names the other
    // as unknown, which is the fix for "one missing leg erased both".
    ['asset-local empty', { state: 'available', asOf, btc: [], eth: [{ observedAt: '2026-08-04T10:00:00.000Z', ratePercent: 0.01234 }] }, 'partial']
  ] as const)('renders the compact %s funding-history state without fabricating BTC or ETH', async (_name, result, state) => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), fearGreedClient: fearGreedClient(), fundingRateClient: result === undefined ? { query: () => new Promise<never>(() => undefined) } : fundingRateClient(result), now: () => new Date(asOf),
      openInterestClient: openInterestClient(),
      onConfigureSources: () => undefined, onManageSource: () => undefined, onOpenCalendar: () => undefined, text: text.dashboard
    })))
    await flush()

    const card = container.querySelector('.mi-positioning-panel')!
    expect(card.textContent).toContain(text.dashboard.positioning.pairTitle)
    // The card no longer blanks when one half is missing: the rate rows print an em dash and the
    // half that failed is named by its own attribute, so a reader can tell which side is absent.
    expect(card.getAttribute('data-funding-state')).toBe(state)
    if (state === 'partial') {
      const rows = card.querySelectorAll('[data-funding-latest]')
      expect(rows[0]?.textContent).toContain('—')
      expect(rows[1]?.textContent).toContain('+0.0123%')
    } else expect(card.textContent).toContain('—')
    expect(card.textContent).not.toMatch(/5\.8|\$42M|\$18M|\$330M|liquidation|open interest|crowded|https?:|sourceUrl|evidence|profile|health|credential|error/i)
  })


  it('keeps the positioning card on screen and says the source is off when both cells are disabled', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    // 两格都关掉：以前整张卡被跳过（读者看到一块空白），现在卡片留下来说一句「来源没有启用」。
    const cellEnabledIo = {
      read: async () => ({
        [dashboardCellId('positioning', 'oi')]: false,
        [dashboardCellId('positioning', 'funding')]: false
      })
    }

    await act(async () => root?.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), fearGreedClient: fearGreedClient(), fundingRateClient: fundingRateClient(), openInterestClient: openInterestClient(), now: () => new Date(asOf),
      onConfigureSources: () => undefined, onManageSource: () => undefined, onOpenCalendar: () => undefined, text: text.dashboard, cellEnabledIo
    })))
    await flush()

    const card = container.querySelector('.mi-positioning-panel')!
    expect(card).not.toBeNull()
    // 两格都没启用：数据区整块盖共享遮罩，居中一颗「启用数据」；标题行那颗不画（两个入口就是两个）。
    expect(card.querySelector('.state-view')).toBeNull()
    expect(card.querySelector('[data-chart-skeleton]')).toBeNull()
    expect(card.querySelector('.mi-source-veil')).not.toBeNull()
    expect(card.querySelector('[data-positioning-title-action]')).toBeNull()
    expect(card.textContent).toContain(text.dashboard.positioning.sourceDisabled.replace('{source}', text.dashboard.positioning.sourceName))
    expect(card.textContent).toContain(text.dashboard.positioning.enableData)
    // 不是空态；两格都没启用时数据区整块盖遮罩，不画图框（骨架属于「部分缺」那一支）。
    expect(card.textContent).not.toContain(text.dashboard.positioning.empty)
    expect(card.querySelector('.mi-positioning-panel__chart')).toBeNull()
  })


  // The macro-market source drives the 市场状态 gold row; the strip has to say what it can actually
  // read, and must never print 采集正常 over an empty store.






  it('injects the cell-enabled client from the page into the dashboard (one instance)', () => {
    // 注入式客户端：页面构造一次、往下传；看板与抽屉读同一份存储。
    // 这条同时钉住「别为了接线去破 IPC 边界」——原始 IPC/transport/service 路径仍然被上一条禁止。
    expect(page).toContain('cellEnabledClient')
    expect(page).toContain('CryptoIntelligenceDashboard')
    expect(page).toContain('cellEnabledIo')
    expect(page).toContain('readSelection')
  })

  it('contains no IPC, service, network, AI, or chart path', () => {
    const sources = [page, portal, dashboard].join('\n')
    // The injected read-only clients are the only IPC these files may name; every other line
    // still has to stay free of transport, service and network paths.
    const injectedClientImports = ['../../shared/ipc/cellEnabledClient', '../../shared/ipc/crossAssetObservationClient', '../../shared/ipc/dashboardFeedStatusClient', '../../shared/ipc/macroMarketSnapshotClient', '../../shared/ipc/macroRatesSnapshotClient', '../../shared/ipc/marketDivergenceClient']
    const withoutInjectedClients = sources.split('\n')
      .filter(line => !injectedClientImports.some(client => line.includes(client))).join('\n')

    expect(withoutInjectedClients).not.toMatch(/(?:shared\/ipc|service\/|\/service|intelligenceSourcesClient|window\.platform)/)
    expect(sources).not.toMatch(/\b(?:fetch|WebSocket|axios|ipcRenderer)\b/)
    expect(dashboard).not.toMatch(/(?:lightweight-charts|series)/i)
  })

  it('no longer ships the dead macro release strip anywhere in the repository', () => {
    // The strip had no call site; only its CSS was asserted. A source-level scan is the guard that
    // stops it being reintroduced as a second interpretation of the same calendar rows.
    const dataAttribute = 'data-release-' + 'dynamics'
    const className = 'mi-crypto-dashboard__' + 'release-dynamics'
    const offenders = repositorySourceFiles(process.cwd()).filter(file => {
      const source = readFileSync(file, 'utf8')
      return source.includes(dataAttribute) || source.includes(className)
    })
    expect(offenders).toEqual([])
  })

  it('keeps the dashboard shell and its gutter ladder in one stylesheet', () => {
    // 壳、页边距与色板 token 只能有一个 owner。两份 `.mi-crypto-dashboard` 靠加载顺序决胜负时，被压住
    // 的那份连自己的 @media 阶梯一起失效 —— 2026-10-27 全屏仍换行，就是按失效值算出来的断点卡偏了 4px。
    expect(pageStyles).not.toMatch(/^\.mi-crypto-dashboard \{/m)
    expect(pageStyles).not.toContain('--mi-dashboard-page-inline')
    expect(pageStyles).not.toContain('--mi-dashboard-page-block')

    const dashboardRootRule = cssBlock(styles, '.mi-crypto-dashboard {')
    const scrollRule = cssBlock(styles, '.mi-crypto-dashboard__scroll {')
    expect(dashboardRootRule).toContain('--mi-dashboard-page-inline: 32px')
    expect(dashboardRootRule).toContain('--mi-dashboard-page-block: 32px')
    // 页边距与容器查询跟着滚动区走：根上留着 padding，容器查询量的内容盒就会宽出 64px，
    // 窄屏堆叠的翻转点随之挪位。
    expect(scrollRule).toContain('padding: var(--mi-dashboard-page-block) var(--mi-dashboard-page-inline)')
    expect(scrollRule).toContain('container-type: inline-size')
    expect(dashboardRootRule).not.toContain('padding: var(--mi-dashboard-page-block)')
    expect(dashboardRootRule).not.toContain('container-type')

    // 阶梯两端成对移动：只缩 inline 会让数据带一头 32 一头 24。
    const ladder = styles.slice(styles.indexOf('@media (max-width: 1279px)'))
    expect(ladder).toContain('--mi-dashboard-page-inline: 24px; --mi-dashboard-page-block: 24px;')
    expect(ladder).toContain('--mi-dashboard-page-inline: 20px; --mi-dashboard-page-block: 20px;')
  })

  it('uses one capital data band and a second sentiment/funding row without unequal panel borders', () => {
    const dashboardRootRule = cssBlock(styles, '.mi-crypto-dashboard {')
    const rowRule = cssBlock(styles, '.mi-crypto-dashboard__capital-positioning-row {')
    const capitalRule = cssBlock(styles, '.mi-capital-conditions {')
    const stackStyles = cssBlock(styles, '@container (max-width: 899px)')

    const scrollRule = cssBlock(styles, '.mi-crypto-dashboard__scroll {')
    expect(rowRule).not.toContain('overflow-x: hidden')
    expect(scrollRule).toContain('container-type: inline-size')
    expect(dashboardRootRule).not.toContain('container-type')
    expect(rowRule).toContain('border-top: 1px solid var(--mi-dashboard-line)')
    expect(rowRule).toContain('border-bottom: 1px solid var(--mi-dashboard-line)')
    // 资金面带现在是「情绪 | 资金面」两列；资金面内部的 content-row 仍是它自己的两列。
    expect(rowRule).toContain('grid-template-columns: minmax(190px, var(--mi-dashboard-positioning-sentiment-allocation)) minmax(0, var(--mi-dashboard-positioning-funding-allocation))')
    expect(dashboardRootRule).toContain('--mi-dashboard-positioning-sentiment-allocation: 1fr')
    expect(dashboardRootRule).toContain('--mi-dashboard-positioning-funding-allocation: 4fr')
    expect(stackStyles).toContain('.mi-crypto-dashboard__capital-positioning-row,')
    expect(capitalRule).not.toContain('border-radius')
    expect(capitalRule).not.toContain('border-top')
    expect(capitalRule).not.toContain('border-bottom')
    // The positioning panel now spans the band on its own, so it must not keep the divider it
    // needed when the gauge sat to its left.
    const fundingRule = cssBlock(styles, '.mi-crypto-dashboard__positioning-row > .mi-positioning-panel {')
    expect(fundingRule).toContain('padding-left: 0')
    expect(fundingRule).toContain('border-left: 0')
    expect(styles).not.toContain('mi-crypto-dashboard__capital-positioning-row .mi-crypto-dashboard__state-card')
    expect(styles).toContain('mi-capital-conditions__etf-table')
  })

  it('keeps the sentiment zone compact and stacks the funding-history panel at narrow widths', () => {
    const sentimentRule = cssBlock(styles, '.mi-crypto-dashboard__sentiment {')
    const stackStyles = cssBlock(styles, '@container (max-width: 899px)')

    expect(sentimentRule).toContain('container-type: inline-size')
    expect(sentimentRule).toContain('container-name: mi-sentiment-positioning')
    expect(stackStyles).toContain('.mi-crypto-dashboard__sentiment,')
    expect(stackStyles).toContain('.mi-crypto-dashboard__capital-positioning-row > .mi-capital-conditions')
  })

  it('uses named compact rhythm inside the real data bands', () => {
    const dashboardRootRule = cssBlock(styles, '.mi-crypto-dashboard {')
    const rowRule = cssBlock(styles, '.mi-crypto-dashboard__capital-positioning-row {')
    const headerBandRule = cssBlock(styles, '.mi-capital-conditions__header-band {')
    const stableRule = cssBlock(styles, '.mi-capital-conditions__etf-col-asset {')
    const gaugeRule = cssBlock(styles, '.mi-crypto-dashboard__sentiment-gauge {')

    expect(dashboardRootRule).toContain('--mi-dashboard-capital-header-row-gap')
    expect(dashboardRootRule).toContain('--mi-dashboard-capital-header-column-gap')
    expect(dashboardRootRule).toContain('--mi-dashboard-band-zone-inline')
    expect(rowRule).toContain('padding: var(--mi-dashboard-band-block-padding) 0')
    expect(headerBandRule).toContain('flex-wrap: wrap')
    expect(headerBandRule).toContain('gap: var(--mi-dashboard-capital-header-row-gap) var(--mi-dashboard-capital-header-column-gap)')
    expect(stableRule).toContain('width: 26%')
    expect(gaugeRule).toContain('padding: var(--mi-dashboard-gauge-block-padding)')
  })

  it('puts the stablecoin and fixed-layout ETF tables in the first band', () => {
    const dashboardRootRule = cssBlock(styles, '.mi-crypto-dashboard {')
    const capitalRule = cssBlock(styles, '.mi-capital-conditions {')
    const headerBandRule = cssBlock(styles, '.mi-capital-conditions__header-band {')
    const stableRule = cssBlock(styles, '.mi-capital-conditions__etf-col-asset {')
    const tableRule = cssBlock(styles, '.mi-capital-conditions__etf-table {')
    const contentRowRule = cssBlock(styles, '.mi-capital-conditions__content-row {')

    expect(capitalRule).toContain('align-content: start')
    expect(capitalRule).toContain('row-gap: var(--mi-dashboard-capital-content-row-gap)')
    expect(contentRowRule).toContain('grid-template-columns: minmax(240px, var(--mi-dashboard-capital-summary-allocation)) minmax(0, var(--mi-dashboard-market-flow-allocation))')
    expect(dashboardRootRule).toContain('--mi-dashboard-capital-summary-allocation: 10fr')
    expect(dashboardRootRule).toContain('--mi-dashboard-market-flow-allocation: 15fr')
    expect(stableRule).toContain('width: 26%')
    expect(tableRule).toContain('table-layout: fixed')
    expect(tableRule).toContain('width: 100%')
    expect(headerBandRule).toContain('min-width: 0')
  })

  it('keeps the unified three-series flow chart beside and as tall as the summary', () => {
    const dashboardRootRule = cssBlock(styles, '.mi-crypto-dashboard {')
    const etfRule = cssBlock(styles, '.mi-capital-conditions__etf-flow {')
    const barsRule = cssBlock(styles, '.mi-capital-conditions__chart {')
    const stackStyles = cssBlock(styles, '@container (max-width: 899px)')

    expect(dashboardRootRule).toContain('--mi-dashboard-etf-flow')
    expect(etfRule).toContain('align-self: stretch')
    expect(etfRule).toContain('grid-template-rows: auto auto minmax(var(--mi-dashboard-etf-flow-chart-height), 1fr)')
    expect(etfRule).toContain('margin-right: var(--mi-dashboard-band-zone-inline)')
    expect(barsRule).toContain('min-height: var(--mi-dashboard-etf-flow-chart-height)')
    expect(barsRule).toContain('linear-gradient')
    expect(stackStyles).toContain('.mi-capital-conditions__etf-flow { margin-right: 0; }')
    expect(stackStyles).toContain('.mi-capital-conditions__content-row')
  })

  it('reserves a real streak column and a caution coverage label in the ETF table', () => {
    const tableRule = cssBlock(styles, '.mi-capital-conditions__etf-table {')
    const streakRule = cssBlock(styles, '.mi-capital-conditions__etf-table tbody td.mi-capital-conditions__streak {')
    const coverageRule = cssBlock(styles, '.mi-capital-conditions__coverage {')

    expect(tableRule).toContain('table-layout: fixed')
    expect(streakRule).toContain('font-size: 10px')
    expect(coverageRule).toContain('color: var(--mi-dashboard-caution)')
    expect(coverageRule).toContain('font-size: 9px')
  })

  it('uses a chart-forward split and a horizontal source status bar', () => {
    const dashboardRootRule = cssBlock(styles, '.mi-crypto-dashboard {')
    const sourceRule = cssBlock(styles, '.mi-crypto-dashboard__source-region {')
    const sourceRowRule = cssBlock(styles, '.mi-crypto-dashboard__source-row {')

    expect(dashboardRootRule).toContain('--mi-dashboard-capital-summary-allocation: 10fr')
    expect(dashboardRootRule).toContain('--mi-dashboard-market-flow-allocation: 15fr')
    expect(dashboardRootRule).toContain('--mi-dashboard-positioning-sentiment-allocation: 1fr')
    expect(dashboardRootRule).toContain('--mi-dashboard-positioning-funding-allocation: 4fr')
    expect(sourceRule).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))')
    expect(sourceRowRule).toContain('display: flex')
    expect(sourceRowRule).not.toContain('grid-template-columns')
    expect(sourceRowRule).toContain('justify-content: start')
    expect(sourceRowRule).toContain('gap: var(--mi-dashboard-source-row-gap)')
    expect(dashboardRootRule).toContain('--mi-dashboard-source-row-gap: 8px')
    expect(styles).toContain('flex: 0 1 auto')
    expect(styles).toContain('flex: 0 0 auto')
    expect(styles).toContain('white-space: nowrap')
  })


  it('lets the ETF table shrink without losing the chart axis', () => {
    const tableRule = cssBlock(styles, '.mi-capital-conditions__etf-table {')
    const chartRule = cssBlock(styles, '.mi-capital-conditions__chart {')
    const stackStyles = cssBlock(styles, '@container (max-width: 899px)')

    expect(tableRule).toContain('width: 100%')
    expect(chartRule).toContain('min-width: 0')
    // 堆叠分支只把两列并成一列，表格列宽不变。
    expect(stackStyles).not.toContain('.mi-capital-conditions__etf-table')
    expect(stackStyles).toContain('.mi-capital-conditions__content-row')
  })

  it('lays the two data bands out side by side by ratio, and stacks only where they cannot fit', () => {
    const contentRowRule = cssBlock(styles, '.mi-capital-conditions__content-row {')
    const positioningRule = cssBlock(styles, '.mi-crypto-dashboard__positioning-row {')
    const stackStyles = cssBlock(styles, '@container (max-width: 899px)')

    expect(contentRowRule).toContain('grid-template-columns: minmax(240px, var(--mi-dashboard-capital-summary-allocation)) minmax(0, var(--mi-dashboard-market-flow-allocation))')
    expect(positioningRule).toContain('grid-template-columns: minmax(0, 1fr)')
    // 并排不再挂在"内容宽 ≥ 1176px"的闸门上：那道闸门在 16 寸全屏上差 4px 就整块塌掉。
    expect(styles).not.toContain('@container (min-width: 1176px)')
    expect(stackStyles).toContain('.mi-crypto-dashboard__capital-positioning-row,')
    expect(stackStyles).toContain('.mi-capital-conditions__content-row { grid-template-columns: minmax(0, 1fr); }')
    expect(stackStyles).toContain('.mi-crypto-dashboard__source-region { grid-template-columns: minmax(0, 1fr); }')
  })

  it('reaches its side-by-side bands in a full-screen laptop pane', () => {
    // 2026-10-27「全屏仍换行」的回归守卫。四段宽度各有 owner：侧栏在 shell 的 styles.css、Agent 栏在
    // marketAnalysisWorkspace.css、页边距与堆叠闸门在 cryptoDashboard.css。这里把它们读出来现算，
    // 而不是抄一个"应该够了"的结论 —— 任何人挪动其中任何一个，这条会先响。
    const shellStyles = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/styles.css'), 'utf8')
    const workspaceStyles = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/marketAnalysisWorkspace.css'), 'utf8')
    const sidebar = Number(/--sidebar-width:\s*(\d+)px/.exec(shellStyles)?.[1])
    const paneLimit = /--mi-agent-pane-width:\s*clamp\(\s*(\d+)px,\s*([\d.]+)cqw,\s*(\d+)px\s*\)/.exec(workspaceStyles)
    const pageInline = Number(/--mi-dashboard-page-inline:\s*(\d+)px/.exec(cssBlock(styles, '.mi-crypto-dashboard {'))?.[1])
    const stackBelow = Number(/@container \(max-width: (\d+)px\)/.exec(styles)?.[1])

    expect(paneLimit, 'Agent 栏宽度必须是有上下限的比例值').not.toBeNull()
    expect(sidebar).toBeGreaterThan(0)
    expect(pageInline).toBeGreaterThan(0)
    expect(stackBelow).toBeGreaterThan(0)

    const paneMin = Number(paneLimit![1])
    const paneShare = Number(paneLimit![2])
    const paneMax = Number(paneLimit![3])
    const agentFor = (page: number): number => Math.min(Math.max(paneMin, (page * paneShare) / 100), paneMax)
    // 页边距阶梯：窗口 ≤1279 时是 24px，否则是基础值。
    const gutterFor = (page: number): number => (page + sidebar <= 1279 ? 24 : pageInline)
    const contentWidth = (page: number, panes: 'single' | 'split'): number =>
      page - (panes === 'split' ? agentFor(page) : 0) - gutterFor(page) * 2

    // 14 英寸 (1512) 与 16 英寸 (1728) 的 Mac 全屏，两种都必须能并排。
    for (const windowWidth of [1512, 1728]) {
      expect(contentWidth(windowWidth - sidebar, 'split'), `${windowWidth}px 窗口的看板内容盒`).toBeGreaterThan(stackBelow)
    }

    // 单栏切换点两侧必须是同一种数据带形态：否则跨过切换点，Agent 栏出现的同时数据带也塌成单列，
    // 版面一次跳两下。切换点取"看板并排还成立"的最小内容宽：900 + 边距 64 + Agent 下限 340。
    const compactAt = Number(/@container mi-analysis-dashboard \(max-width: (\d+)px\)/.exec(workspaceStyles)?.[1])
    expect(compactAt).toBeGreaterThan(0)
    expect(contentWidth(compactAt, 'single'), '切换点以下（单栏）').toBeGreaterThanOrEqual(stackBelow)
    expect(contentWidth(compactAt + 1, 'split'), '切换点以上（双栏）').toBeGreaterThanOrEqual(stackBelow)
  })

  it('renders sentiment with capital in the first band and the perpetual card in the second', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), fearGreedClient: fearGreedClient(), fundingRateClient: fundingRateClient(), openInterestClient: openInterestClient(),
      capitalConditionsClient: capitalConditionsClient(), now: () => new Date(asOf), onConfigureSources: () => undefined,
      onManageSource: () => undefined, onOpenCalendar: () => undefined, text: productText['en-US'].pages.intelligence.portal.dashboard
    } as never)))
    await flush()
    const row = container.querySelector<HTMLElement>('.mi-crypto-dashboard__capital-positioning-row')!
    const capital = row.querySelector<HTMLElement>('.mi-capital-conditions')!
    expect([...row.children].map((child) => child.className || child.tagName)).toEqual(['mi-crypto-dashboard__sentiment', 'mi-capital-conditions'])
    const positioning = container.querySelector<HTMLElement>('.mi-crypto-dashboard__positioning-row')!
        // The perpetual card keeps the second band to itself, with the divergence footnote under it.
    expect([...positioning.children].map((child) => child.className || child.tagName)).toEqual(['mi-positioning-panel', 'mi-divergence'])
    expect([...capital.children].map((child) => child.className || child.tagName)).toEqual(['mi-capital-conditions__content-row'])
    expect([...capital.firstElementChild!.children].map((child) => child.className || child.tagName)).toEqual(['mi-capital-conditions__summary', 'mi-capital-conditions__etf-flow'])
    const headerBandRule = cssBlock(styles, '.mi-capital-conditions__header-band {')
    expect(headerBandRule).toContain('display: flex')
    expect(headerBandRule).toContain('flex-wrap: wrap')
    expect(headerBandRule).toContain('min-width: 0')
  })

  it('renders the gauge as five fear-to-greed color segments with a matching bucket needle', () => {
    expect(styles).toContain('--mi-dashboard-sentiment-extreme-fear')
    expect(styles).toContain('--mi-dashboard-sentiment-fear')
    expect(styles).toContain('--mi-dashboard-sentiment-neutral')
    expect(styles).toContain('--mi-dashboard-sentiment-greed')
    expect(styles).toContain('--mi-dashboard-sentiment-extreme-greed')
    expect(styles).toContain("[data-gauge-bucket='extreme-fear']")
    expect(styles).toContain("[data-gauge-bucket='extreme-greed']")
    expect(styles).toContain("[data-gauge-bucket-text='extreme-fear']")
    expect(styles).toContain("[data-gauge-bucket-text='extreme-greed']")
  })



  it('relays the card’s own staleness verdict into the 持仓 row, same instant and no second threshold', async () => {
    // 行不许自己判新鲜度：它只转述卡片算出的 `staleSince`。同一份视图 → 行与卡必须同时是「偏旧」，
    // 且写的是**同一个时刻**（同一个统一格式化）。改 policy 时两者一起翻，只翻一处就该红。
    const view = projectDashboardPositioning({
      state: 'available', asOf, window: '7d',
      btc: [{ observedAt: '2026-08-04T22:00:00.000Z', notionalUsd: 7_269_000_000 }],
      eth: [{ observedAt: '2026-08-04T22:00:00.000Z', notionalUsd: 3_190_000_000 }],
      liquidationHintsState: 'available'
    }, asOf, '7d')
    if (view.state !== 'available') throw new Error('expected available')
    const row = projectPositioningSourceRow(view, { state: 'available' })
    expect(row).toEqual({ kind: 'stale', since: view.staleSince })
    expect(view.staleSince).toBe('2026-08-04T22:00:00.000Z')

    // 反方向：卡片判不旧（读数就在 asOf 前一刻）→ 行也必须是「读到」，不许自己再判一次。
    const fresh = projectDashboardPositioning({
      state: 'available', asOf, window: '7d',
      btc: [{ observedAt: '2026-08-04T23:45:00.000Z', notionalUsd: 7_269_000_000 }],
      eth: [{ observedAt: '2026-08-04T23:45:00.000Z', notionalUsd: 3_190_000_000 }],
      liquidationHintsState: 'available'
    }, asOf, '7d')
    if (fresh.state !== 'available') throw new Error('expected available')
    expect(fresh.staleSince).toBeUndefined()
    expect(projectPositioningSourceRow(fresh, { state: 'available' })).toEqual({ kind: 'read', fundingPartial: false })
  })

  it('keeps no hand-written button elements in the dashboard', () => {
    // 命令型一律平台控件：这份源码里再出现裸 `<button>` 就说明又一个交互元素回到了自绘状态，
    // 而自绘按钮在这页上已经两次被用户当成"按钮没吃到样式"报出来。
    expect(dashboard).not.toContain('<button')
  })

  it('keeps the funding-history component isolated from dashboard layout styles', () => {
    expect(styles).not.toContain('.mi-positioning-panel__chart')
    expect(styles).not.toContain('.mi-crypto-dashboard__funding-rates')
  })

  it('hides the daily brief entry while the sample replay is active', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), fearGreedClient: fearGreedClient(), fundingRateClient: fundingRateClient(), openInterestClient: openInterestClient(),
      now: () => new Date(asOf), onConfigureSources: () => undefined,
      onManageSource: () => undefined, onOpenCalendar: () => undefined, text: text.dashboard,
      briefingEnabled: false
    })))
    await flush()
    expect(container.querySelector('.mi-crypto-dashboard__briefing')).toBeNull()
    expect(container.textContent).not.toContain(text.dashboard.dailyBriefing.entry)
  })

  it('navigates to the daily brief page from the header', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const onOpenBriefing = vi.fn()
    await act(async () => root?.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), fearGreedClient: fearGreedClient(), fundingRateClient: fundingRateClient(), openInterestClient: openInterestClient(),
      now: () => new Date(asOf), onConfigureSources: () => undefined,
      onManageSource: () => undefined, onOpenCalendar: () => undefined, text: text.dashboard,
      onOpenBriefing
    })))
    await flush()

    await act(async () => findButton(container, text.dashboard.dailyBriefing.entry).click())
    expect(onOpenBriefing).toHaveBeenCalledTimes(1)
  })

  it('keeps the dashboard shell constrained so its cards scroll inside the column', () => {
    const dashboardRootRule = cssBlock(styles, '.mi-crypto-dashboard {')
    const scrollRule = cssBlock(styles, '.mi-crypto-dashboard__scroll {')

    expect(dashboardRootRule).toContain('height: 100%')
    expect(dashboardRootRule).toContain('min-height: 0')
    // 根是列：滚动区吃掉剩余高度（原先分给「本次运行」页脚的那一份，整块下架后归滚动区）。
    expect(dashboardRootRule).toContain('display: flex')
    expect(dashboardRootRule).toContain('flex-direction: column')
    expect(dashboardRootRule).toContain('overflow: hidden')
    expect(scrollRule).toContain('flex: 1 1 0')
    expect(scrollRule).toContain('overflow-y: auto')
    expect(scrollRule).toContain('overflow-x: hidden')
    expect(dashboardRootRule).not.toContain('min-height: 100%')
  })

  it('keeps the reading order off the body and on the title’s own ⓘ', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), fearGreedClient: fearGreedClient(), fundingRateClient: fundingRateClient(), openInterestClient: openInterestClient(),
      now: () => new Date(asOf), onConfigureSources: () => undefined,
      onManageSource: () => undefined, onOpenCalendar: () => undefined, text: text.dashboard
    })))
    await flush()

    // 正文只留标题：那句读法（阅读顺序 + 不以中性填补）不再占正文一行。
    expect(container.textContent).not.toContain(text.dashboard.description)

    // ⓘ 与标题在**同一个父容器**里，名字是它的短名——不是「一行空容器只放图标」，也不是两个块级兄弟。
    const row = container.querySelector<HTMLElement>('.mi-crypto-dashboard__title-row')
    expect(row?.querySelector('h1')?.textContent).toBe(text.dashboard.title)
    const trigger = row?.querySelector<HTMLButtonElement>('button')
    expect(trigger?.getAttribute('aria-label')).toBe(text.dashboard.descriptionLabel)

    // 窄容器里图标不换行：同一行是 flex + nowrap，图标 flex:none（挤掉的是文字，不是把它甩下一行）。
    const rowRule = cssBlock(styles, '.mi-crypto-dashboard__title-row {')
    expect(rowRule).toMatch(/display:\s*flex/)
    expect(rowRule).toMatch(/flex-wrap:\s*nowrap/)
    expect(rowRule).toMatch(/gap:\s*4px/)
    expect(cssBlock(styles, '.mi-crypto-dashboard__title-row > .ant-btn {')).toMatch(/flex:\s*none/)

    // 那句话还在，只是搬进了浮层：点开 ⓘ 才出现（浮层挂 body）。
    await act(async () => trigger?.click())
    await flush()
    expect(document.body.textContent).toContain(text.dashboard.description)
  })

  it('offers no way back to the agent portal from the header', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), fearGreedClient: fearGreedClient(), fundingRateClient: fundingRateClient(), openInterestClient: openInterestClient(),
      now: () => new Date(asOf), onConfigureSources: () => undefined,
      onManageSource: () => undefined, onOpenCalendar: () => undefined, text: text.dashboard
    })))
    await flush()

    // 用户 2026-11-09：那个说法已经不存在，按钮整个去掉。选择页仍留着（暂时没有入口），
    // 所以这里钉的是「页头不提供离开看板的入口」，不是「那一屏不存在」。
    expect(container.querySelector('.mi-crypto-dashboard__back')).toBeNull()
    // 页头命令就是这两颗：多一颗（尤其那颗复活）就红，少了也不放过。
    const tools = container.querySelector<HTMLElement>('.mi-crypto-dashboard__tools')!
    // 页头命令：日报入口 + 配置情报源 + 静态配置抽屉入口（0.4.3 预览版）。
    // 多一颗、少一颗都红——新增入口必须同时改这条断言，别用「包含」把它放水。
    // 用户 2026-11-11：页头只留两颗（日报入口 + 配置情报源）；那颗只写「配置」的静态抽屉入口退役。
    expect([...tools.querySelectorAll<HTMLButtonElement>('.ant-btn')].map(button => button.textContent))
      .toEqual([text.dashboard.dailyBriefing.entry, text.dashboard.configureSources])
    expect(tools.querySelector('.mi-crypto-dashboard__settings')).toBeNull()
  })
})

/**
 * Every text source file in the checkout, excluding build output and the private docs.
 *
 * The check is deliberately repository-wide: the strip was once a design-mandated surface, so a
 * future reintroduction would most likely start in a page or stylesheet outside this folder.
 */
function repositorySourceFiles(root: string, directory = root): string[] {
  const skippedDirectories = new Set(['node_modules', '.git', 'out', 'dist', 'build', 'coverage', 'release', 'docs-private'])
  const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.css', '.json', '.md', '.html'])
  const files: string[] = []
  for (const entry of readdirSync(directory)) {
    if (entry.startsWith('.') || skippedDirectories.has(entry)) continue
    const path = join(directory, entry)
    const stats = lstatSync(path)
    if (stats.isSymbolicLink()) continue
    if (stats.isDirectory()) files.push(...repositorySourceFiles(root, path))
    else if (sourceExtensions.has(entry.slice(entry.lastIndexOf('.'))) && stats.size < 2_000_000) files.push(path)
  }
  return files
}

/**
 * The fixtures below answer as the dashboard's own clients do.
 *
 * Each helper is typed by the prop it fills, and each payload by what that prop really answers:
 * `unknown` here let every case pass a shape the component could never receive, which is exactly the
 * blind spot the widened typecheck found (42 calls that "worked" only in the test).
 */
type DashboardProps = Parameters<typeof CryptoIntelligenceDashboard>[0]
type CalendarEvents = Extract<Awaited<ReturnType<DashboardProps['client']['queryMonth']>>, { state: 'available' }>['events']
type FearGreedSnapshot = Awaited<ReturnType<DashboardProps['fearGreedClient']['querySnapshot']>>
type OpenInterestResult = Awaited<ReturnType<DashboardProps['openInterestClient']['query']>>
type CapitalConditionsSnapshot = Awaited<ReturnType<NonNullable<DashboardProps['capitalConditionsClient']>['querySnapshot']>>

function dashboardClient(events: CalendarEvents = []): DashboardProps['client'] {
  return { queryMonth: async () => ({ state: 'available' as const, asOf, events }) }
}

function dashboardClientByMonth(eventsByMonth: Record<string, CalendarEvents>): DashboardProps['client'] {
  return { queryMonth: async ({ month }) => ({ state: 'available' as const, asOf, events: eventsByMonth[month] ?? [] }) }
}

function fearGreedClient(result: FearGreedSnapshot = { state: 'empty' as const, asOf }): DashboardProps['fearGreedClient'] {
  return { querySnapshot: async () => result }
}

function openInterestClient(result: OpenInterestResult = { state: 'empty' as const, asOf, window: '7d' as const }): DashboardProps['openInterestClient'] {
  return { query: async () => result }
}

function fundingRateClient(result: unknown = { state: 'empty' as const, asOf }): DashboardProps['fundingRateClient'] {
  return { query: async () => result }
}

function capitalConditionsClient(result: CapitalConditionsSnapshot = {
  state: 'available' as const, asOf, etf: { state: 'unavailable' as const }, conclusion: 'partial' as const,
  coreStablecoins: { observedAt: '2026-08-04T23:00:00.000Z', verifiedAt: asOf, currentUsd: 254_900_000_000, change1dUsd: 82_400_000, change1dPercent: 0.0323, change7dUsd: 82_400_000, change7dPercent: 0.0323, change30dUsd: -500_000_000, change30dPercent: -0.21 }
}): NonNullable<DashboardProps['capitalConditionsClient']> {
  return { querySnapshot: vi.fn(async () => result) }
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((entry) => entry.textContent === label)
  if (!button) throw new Error(`button not found: ${label}`)
  return button
}

function event(overrides: Partial<MacroEconomicCalendarEventView> = {}): MacroEconomicCalendarEventView {
  return {
    eventKey: 'US.CPI.RELEASE.uid-1', releaseGroupKey: 'US.BLS.RELEASE.uid-1', eventFamily: 'cpi', titleKey: 'cpi',
    countryCode: 'US', importance: 'high', periodKey: 'release-2026-08-12', lifecycleState: 'scheduled', coverage: 'available',
    scheduledDate: '2026-08-12', scheduledAt: '2026-08-12T12:30:00.000Z', releaseTimeSource: 'official', detectedAt: asOf,
    consensus: null, consensusState: 'unavailable', surprise: 'consensus-unavailable', providerIds: ['macro-calendar-bls'], caveats: [],
    ...overrides
  }
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

/**
 * 宿主接线的两条路径（来源：资金情绪在已提交树上实跑 3/3 绿，本文件并库；它的临时
 * `__probe*.test.tsx` 已删、不入库）。
 *
 * 为什么这两个读口必须注入：`cellEnabledIo`（格级启用/选源）与 `dashboardFeedStatusClient`（源级启用表）
 * 在应用里**永远**被注入，而页面级用例以前从没传过——所有依赖它们的路径（遮罩、行内状态、
 * 首帧加载态）在测试里都走不到，`decideCellRead is not defined` / `LoadingState is not defined`
 * 这类缺 import 的错因此看不见。以下用例一律把两个口注入，并用确定性微任务轮次推进（不 sleep）。
 */
describe('host wiring: cells switched off and sources judged', () => {
  const dashboardText = productText['zh-CN'].pages.intelligence.portal.dashboard
  const dataText = productText['zh-CN'].pages.intelligence.portal.data
  const readableSentiment = { state: 'available' as const, asOf, score: 22, bucket: 'extreme-fear' as const, observedAt: '2026-08-04T10:00:00.000Z' }
  const allEnabled = [
    { sourceId: 'alternative-fear-greed' as const, enabled: true, hasCredential: true },
    { sourceId: 'defillama-stablecoins' as const, enabled: true, hasCredential: true },
    { sourceId: '0xrouter-aggregate-provider' as const, enabled: true, hasCredential: true }
  ]

  async function settle(container: HTMLElement, selector: string): Promise<void> {
    for (let round = 0; round < 20; round += 1) {
      if (container.querySelector(selector) !== null) return
      await act(async () => { await Promise.resolve() })
    }
  }

  async function renderCells(cells: Record<string, boolean>, extra: Record<string, unknown>) {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), fearGreedClient: fearGreedClient(), fundingRateClient: fundingRateClient(),
      openInterestClient: openInterestClient(), now: () => new Date(asOf),
      dashboardFeedStatusClient: { query: async () => ({ state: 'available' as const, sources: allEnabled }) },
      onConfigureSources: () => undefined, onManageSource: () => undefined, onOpenCalendar: () => undefined,
      text: dashboardText, cellEnabledIo: { read: async () => cells },
      ...extra
    } as never)))
    return container
  }

  it('市场状态卡: one enable entry beside the title, landing on the cell that is off', async () => {
    const onManageSource = vi.fn()
    const container = await renderCells({ 'quotes:usd': false }, {
      onManageSource,
      crossAssetClient: {
        acquire: async () => ({ state: 'active' as const, leaseId: 'lease-1' }),
        renew: async () => ({ state: 'active' as const }),
        release: async () => undefined,
        refresh: vi.fn(async () => ({ state: 'accepted' as const })),
        query: async () => ({ state: 'unavailable' as const, cause: 'query' as const })
      }
    })
    await settle(container, '.mi-cross-asset__quote-heading button')

    const card = container.querySelector('.mi-cross-asset')!
    const titleButton = [...card.querySelectorAll<HTMLButtonElement>('.mi-cross-asset__quote-heading button')]
      .find(button => button.textContent === '启用数据')
    expect(titleButton).toBeDefined()
    // 同屏只得这一颗「补数据」动作：表尾与行内都不再有。
    const actions = [...card.querySelectorAll('button')]
      .map(button => button.textContent ?? '')
      .filter(label => ['启用数据', '再试一次', '去启用', '更新历史'].includes(label))
    expect(actions).toEqual(['启用数据'])

    await act(async () => titleButton!.click())
    // 落点是对得上的那一格（读者点下去抽屉直接定位到它，而不是只停在看板组）。
    expect(onManageSource).toHaveBeenCalledWith({ business: 'dashboard', moduleKey: 'quotes', cellId: 'quotes:usd' })
  })

  it('cell off: the sentiment card keeps its figure, drops the needle, and offers one enable action', async () => {
    const onManageSource = vi.fn()
    const container = await renderCells({ 'fear-greed:index': false }, {
      fearGreedClient: fearGreedClient(readableSentiment as never), onManageSource
    })
    await settle(container, '.mi-crypto-dashboard__sentiment [data-sentiment-state]')
    const card = container.querySelector('.mi-crypto-dashboard__sentiment')!
    expect(card.querySelector('h2')?.textContent).toBe(dashboardText.sentiment.title)
    // 图还在（弧线、刻度、三个标签），指针与读数圆盘不在——它们指向一个不存在的分数。
    expect(card.querySelectorAll('.mi-crypto-dashboard__gauge-segment').length).toBeGreaterThan(0)
    expect(card.querySelector('.mi-crypto-dashboard__gauge-needle')).toBeNull()
    expect(card.querySelector('.mi-crypto-dashboard__gauge-readout')).toBeNull()
    const row = card.querySelector('[data-sentiment-state]')!
    expect(row.getAttribute('data-sentiment-state')).toBe('disabled')
    expect(row.textContent).toContain(`${dataText.sourcesNotEnabled}（恐惧与贪婪）`)
    const buttons = [...row.querySelectorAll('button')]
    expect(buttons).toHaveLength(1)
    expect(buttons[0]?.textContent).toBe(dataText.enableSources)
    expect(card.textContent).not.toContain('22')
    expect(card.querySelector('.state-view')).toBeNull()
    await act(async () => buttons[0]!.click())
    expect(onManageSource).toHaveBeenCalledTimes(1)
  })

  it('read failure: one row under the figure says temporarily unreadable, with one retry', async () => {
    const container = await renderCells({}, {
      fearGreedClient: fearGreedClient({ state: 'unavailable', failureCode: 'fear-greed-query-unavailable' } as never)
    })
    await settle(container, '.mi-crypto-dashboard__sentiment [data-sentiment-state]')
    const card = container.querySelector('.mi-crypto-dashboard__sentiment')!
    const row = card.querySelector('[data-sentiment-state]')!
    expect(row.getAttribute('data-sentiment-state')).toBe('unreadable')
    expect(row.textContent).toContain(dataText.temporarilyUnavailable)
    const buttons = [...row.querySelectorAll('button')]
    expect(buttons).toHaveLength(1)
    expect(buttons[0]?.textContent).toBe(dataText.retry)
    // 图仍画着，指针不画；旧的整块 `StateView` 也不回来。
    expect(card.querySelector('.mi-crypto-dashboard__gauge-segment')).not.toBeNull()
    expect(card.querySelector('.mi-crypto-dashboard__gauge-needle')).toBeNull()
    expect(card.querySelector('.state-view')).toBeNull()
  })

  it('cell on and readable: the gauge with its needle, and no state row', async () => {
    const container = await renderCells({}, { fearGreedClient: fearGreedClient(readableSentiment as never) })
    await settle(container, '.mi-crypto-dashboard__gauge-segment')
    const card = container.querySelector('.mi-crypto-dashboard__sentiment')!
    // 有数据时没有那一行：状态句只在没读数时出现。
    expect(card.querySelector('[data-sentiment-state]')).toBeNull()
    expect(card.querySelectorAll('.mi-crypto-dashboard__gauge-segment')).toHaveLength(5)
    expect(card.querySelector('.mi-crypto-dashboard__gauge-needle')).not.toBeNull()
    expect(card.textContent).toContain('22')
  })
})

describe('host wiring: capital cells, one row at a time', () => {
  const dashboardText = productText['zh-CN'].pages.intelligence.portal.dashboard
  const dataText = productText['zh-CN'].pages.intelligence.portal.data
  const capitalSnapshot = {
    state: 'available' as const, asOf, conclusion: 'partial' as const, etf: { state: 'unavailable' as const },
    coreStablecoins: {
      observedAt: '2026-08-04T23:00:00.000Z', verifiedAt: asOf, currentUsd: 254_900_000_000,
      change1dUsd: 82_400_000, change1dPercent: 0.0323, change7dUsd: 82_400_000, change7dPercent: 0.0323,
      change30dUsd: -500_000_000, change30dPercent: -0.21
    }
  }

  async function renderCapital(cells: Record<string, boolean>, query: ReturnType<typeof vi.fn> = vi.fn(async () => capitalSnapshot), onManageSource = vi.fn()) {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), fearGreedClient: fearGreedClient(), fundingRateClient: fundingRateClient(),
      openInterestClient: openInterestClient(),
      capitalConditionsClient: { querySnapshot: query }, now: () => new Date(asOf),
      dashboardFeedStatusClient: { query: async () => ({ state: 'available' as const, sources: [
        { sourceId: 'defillama-stablecoins' as const, enabled: true, hasCredential: true },
        { sourceId: '0xrouter-aggregate-provider' as const, enabled: true, hasCredential: true },
        { sourceId: 'alternative-fear-greed' as const, enabled: true, hasCredential: true }
      ] }) },
      onConfigureSources: () => undefined, onManageSource, onOpenCalendar: () => undefined,
      text: dashboardText, cellEnabledIo: { read: async () => cells }
    } as never)))
    for (let round = 0; round < 20; round += 1) {
      const card = container.querySelector('.mi-capital-conditions')
      if (card && (card.querySelector('.mi-capital-conditions__stable-table') !== null || card.querySelector('.mi-source-state') !== null)) break
      await act(async () => { await Promise.resolve() })
    }
    return { container, query, onManageSource }
  }

  /** 可读的 ETF 快照（线格式）：5 行/资产、日期严格递增、verifiedAt 在 48h 内。 */
  const readableEtf = {
    state: 'available' as const, schemaVersion: 1 as const, sourceId: '0xrouter' as const,
    windowEnd: '2026-07-31', verifiedAt: '2026-08-04T23:00:00.000Z',
    /* 5 行、且必须是**连续交易日**（跨周末的日历日会被 `previousTradingDate` 判非法）：07-27 周一 → 07-31 周五。 */
    btc: { asset: 'BTC' as const, rows: ['27', '28', '29', '30', '31'].map(day => ({
      tradingDate: `2026-07-${day}`, netFlowUsd: -95_000_000, observedAt: '2026-07-31T22:00:00.000Z'
    })) },
    eth: { asset: 'ETH' as const, rows: ['27', '28', '29', '30', '31'].map(day => ({
      tradingDate: `2026-07-${day}`, netFlowUsd: -1_300_000, observedAt: '2026-07-31T22:00:00.000Z'
    })) }
  }

  it('only ETF off: the off rows are dashes with no numbers left, and the one action sits in the title', async () => {
    const { container } = await renderCapital({ 'capital:etf': false })
    const card = container.querySelector('.mi-capital-conditions')!
    // 源关掉：这一块给一句状态词，两行数据格画横杠（两种表示并存，不是二选一）。
    const stateWords = [...card.querySelectorAll('.mi-source-state')]
    expect(stateWords.map(word => word.getAttribute('data-state'))).toEqual(['disabled'])
    expect(stateWords[0]!.textContent).toContain(`${dataText.sourcesNotEnabled}（ETF）`)
    // 另一格照旧出数。
    expect(card.querySelector('.mi-capital-conditions__stable-table')).not.toBeNull()
    // 关掉那一格：两行行名在，数据格全是横杠，且一个数字都不许留（旧读数必须消失）。
    const offRows = [...card.querySelectorAll('[data-etf-cell-off]')]
    expect(offRows.map(row => row.getAttribute('data-etf-cell-off'))).toEqual(['btc', 'eth'])
    for (const row of offRows) {
      expect(row.textContent).toContain('—')
      expect((row.textContent ?? '').replace(/[^0-9]/g, '')).toBe('')
    }
    // 唯一动作在标题行右侧。
    const actions = [...card.querySelectorAll('.mi-capital-conditions__title-action')]
    expect(actions).toHaveLength(1)
    expect(actions[0]!.textContent).toBe(dashboardText.crossAsset.enableData)
    expect(card.querySelector('.mi-capital-conditions__table-actions')).toBeNull()
    expect(card.querySelector('.state-view')).toBeNull()
  })

  it('both off: the card stays behind the veil with one action inside, and the read is never started', async () => {
    const { container, query } = await renderCapital({ 'capital:stablecoin': false, 'capital:etf': false })
    const card = container.querySelector('.mi-capital-conditions')!
    expect(card.querySelector('.mi-source-veil-host')!.getAttribute('data-veiled')).toBe('true')
    // 不画表头骨架。
    expect(card.querySelector('thead')).toBeNull()
    expect(card.querySelector('.mi-capital-conditions__stable-table')).toBeNull()
    // 遮罩里：一句「来源没有启用」+ 恰一颗「启用数据」。
    const veil = card.querySelector('.mi-source-veil')!
    expect(veil).not.toBeNull()
    expect(veil.querySelector('.mi-source-state')!.getAttribute('data-state')).toBe('disabled')
    expect(veil.textContent).toContain(dataText.sourcesNotEnabled)
    expect([...veil.querySelectorAll('button')]).toHaveLength(1)
    expect(veil.querySelector('button')!.textContent).toBe(dashboardText.crossAsset.enableData)
    // 卡内可聚焦元素恰 1 个（就是遮罩里那颗），标题行没有任何动作。
    const focusable = [...card.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    expect(focusable).toHaveLength(1)
    expect(card.querySelector('.mi-capital-conditions__title-action')).toBeNull()
    expect(card.querySelector('.state-view')).toBeNull()
    // 门禁只剩在请求上：两格都关时一次都不发。
    expect(query).not.toHaveBeenCalled()
  })

  it('nothing off and both cells readable: the ordinary card, and no action at all', async () => {
    const { container } = await renderCapital({}, vi.fn(async () => ({ ...capitalSnapshot, etf: readableEtf })))
    const card = container.querySelector('.mi-capital-conditions')!
    expect(card.querySelector('.mi-capital-conditions__stable-table')).not.toBeNull()
    expect(card.textContent).not.toContain('—')
    expect(card.querySelector('.mi-capital-conditions__title-action')).toBeNull()
    // 两格都读到：ETF 表是数据行，不是「读不到」那一行。
    expect(card.querySelector('[data-etf-unavailable]')).toBeNull()
    expect(card.querySelector('[data-etf-cell-off]')).toBeNull()
    // 资金流那块自己的读数不在本条的判据里（它走另一路查询），这里只钉「这一格读到 = 无动作」。
  })

  it('nothing off but the ETF half unreadable: a state word in that row, one retry in the title', async () => {
    // 夹具里 ETF 是 `unavailable`（读不到，不是「没有」）：表留着，那一行一句状态词。
    const { container } = await renderCapital({})
    const card = container.querySelector('.mi-capital-conditions')!
    expect(card.querySelector('.mi-capital-conditions__stable-table')).not.toBeNull()
    const unavailableRow = card.querySelector('[data-etf-unavailable="true"]')!
    expect(unavailableRow).not.toBeNull()
    expect(unavailableRow.querySelector('.mi-source-state')!.getAttribute('data-state')).toBe('unreadable')
    expect(unavailableRow.textContent).toContain(dataText.temporarilyUnavailable)
    // 读不到不画横杠（横杠留给「确实没有」），整张卡一处动作：标题行「再试一次」。
    expect(card.textContent).not.toContain('—')
    const action = card.querySelector('.mi-capital-conditions__title-action')!
    expect(action.textContent).toBe(dataText.retry)
    expect([...card.querySelectorAll('button')].filter(button => button.textContent === dataText.retry || button.textContent === dashboardText.crossAsset.enableData)).toHaveLength(1)
  })
})


describe('host wiring: each capital cell focuses its own cell', () => {
  // TODO(focus): 宿主闭包现在仍是 `() => onManageSource()`（focus 通道未到），所以这里只证「点了有反应」。
  // 通道落地后补 `toHaveBeenLastCalledWith({ business: 'dashboard', moduleKey: 'capital', cellId: 'capital:stablecoin' })`（只关 ETF 时是 `capital:etf`）。
  it('one cell off → the title action carries that cell', async () => {
    const onManageSource = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const query = vi.fn(async () => ({
      state: 'available' as const, asOf, conclusion: 'partial' as const, etf: { state: 'unavailable' as const },
      coreStablecoins: {
        observedAt: '2026-08-04T23:00:00.000Z', verifiedAt: asOf, currentUsd: 254_900_000_000,
        change1dUsd: 82_400_000, change1dPercent: 0.0323, change7dUsd: 82_400_000, change7dPercent: 0.0323,
        change30dUsd: -500_000_000, change30dPercent: -0.21
      }
    }))
    await act(async () => root?.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), fearGreedClient: fearGreedClient(), fundingRateClient: fundingRateClient(),
      openInterestClient: openInterestClient(),
      capitalConditionsClient: { querySnapshot: query }, now: () => new Date(asOf),
      dashboardFeedStatusClient: { query: async () => ({ state: 'available' as const, sources: [
        { sourceId: 'defillama-stablecoins' as const, enabled: true, hasCredential: true },
        { sourceId: '0xrouter-aggregate-provider' as const, enabled: true, hasCredential: true },
        { sourceId: 'alternative-fear-greed' as const, enabled: true, hasCredential: true }
      ] }) },
      onConfigureSources: () => undefined, onManageSource, onOpenCalendar: () => undefined,
      text: productText['zh-CN'].pages.intelligence.portal.dashboard,
      cellEnabledIo: { read: async () => ({ 'capital:stablecoin': false }) }
    } as never)))
    for (let round = 0; round < 20; round += 1) {
      if (container.querySelector('.mi-capital-conditions__title-action') !== null) break
      await act(async () => { await Promise.resolve() })
    }
    const action = container.querySelector<HTMLButtonElement>('.mi-capital-conditions__title-action')
    expect(action).not.toBeNull()
    expect(action!.textContent).toBe(productText['zh-CN'].pages.intelligence.portal.dashboard.crossAsset.enableData)
    await act(async () => action!.click())
    // 只证「点了有反应」；落点是哪个 cellId 见上面的 TODO(focus)。
    expect(onManageSource).toHaveBeenCalledTimes(1)
  })
})
