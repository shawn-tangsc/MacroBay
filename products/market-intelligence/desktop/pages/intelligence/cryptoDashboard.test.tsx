// @vitest-environment happy-dom
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { fillLabelParams } from '@platform/ui/components/textKeyParams'
import { productText } from '../../shared/i18n/productText'
import { CHART_HEIGHT } from '../../features/industry/market-sentiment/DefensivePremiumCharts'
import { CHART_PALETTE_FIXTURE } from '../../features/industry/market-sentiment/defensivePremiumChartPalette.fixture'
import {
  CHART_FONTS_FALLBACK, fearGreedChartOption, gaugeChartOption, skewChartOption
} from '../../features/industry/market-sentiment/defensivePremiumChartOptions'
import type { MacroMarketSnapshotView } from '../../../contracts/macro/macroMarketSnapshotContracts'
import type { MacroEconomicCalendarEventView } from '../../../contracts/macro/economicCalendarQueryContracts'
import { AgentPortal } from './AgentPortal'
import { CryptoIntelligenceDashboard as RawCryptoIntelligenceDashboard } from './CryptoIntelligenceDashboard'
import { dashboardFeedStatusPublicPolicy } from '../../../contracts/macro/dashboardFeedStatusContracts'
import type { FearGreedSnapshotResult, SentimentOptionsCardResult } from '../../../contracts/intelligenceQueryContracts'

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
    expect(page.match(/sourcesDataRequestFor\(/g)?.length ?? 0).toBeGreaterThanOrEqual(5)
    /* 旧日历页整页删掉（2026-11-15），它那一颗「配置日历」跟着没了：日历现在只剩抽屉，
       抽屉的配置入口不传业务位置。这条原来断言页面里写着 `business: 'calendar'`，改成了
       「这处已经不存在」——留着它就会逼下一个人为一句过时的断言把页面加回来。 */
    expect(page).not.toContain("sourcesDataRequestFor({ business: 'calendar' })")
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
      client: dashboardClient(), sentimentOptionsClient: sentimentOptionsClient({
        state: 'available', asOf, score, bucket, observedAt: '2026-08-04T10:00:00.000Z'
      }), fundingRateClient: fundingRateClient(), openInterestClient: openInterestClient(), now: () => new Date(asOf),
      onConfigureSources: () => undefined, onManageSource: () => undefined, text: text.dashboard
    })))
    await flush()
    return {
      // 仪表现在只此一副，住在「恐惧与防跌溢价」卡的中间那一列；档位词在头栏中轨（用户 2026-11-24）。
      gauge: container.querySelector<HTMLElement>('[data-sentiment-gauge]')!,
      band: container.querySelector<HTMLElement>('[data-testid="defensive-premium-card"]')!,
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
                client: dashboardClient(),
        sentimentOptionsClient: sentimentOptionsClient(), fundingRateClient: fundingRateClient(), openInterestClient: openInterestClient(),
        now: () => new Date(asOf),
        text: text.dashboard,
      })
    )

    // 情绪不再单独一格：卡名与它左半的行名都在，旧的「市场情绪」那一格已经不在页面上。
    expect(markup).toContain(text.dashboard.defensivePremium.title)
    expect(markup).toContain(text.dashboard.defensivePremium.fearGreed.name)
    expect(markup).not.toContain(text.dashboard.sentiment.title)
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
        client: dashboardClient(),
        sentimentOptionsClient: sentimentOptionsClient(), fundingRateClient: fundingRateClient(), openInterestClient: openInterestClient(),
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
      client: dashboardClient(), sentimentOptionsClient: sentimentOptionsClient(), fundingRateClient: fundingRateClient(),
      openInterestClient: openInterestClient(), now: () => new Date(asOf),
      cellEnabledIo: { read: pendingRead, readSelection: pendingSelection },
      dashboardFeedStatusClient: allSourcesEnabled,
      onConfigureSources: () => undefined, onManageSource: () => undefined,
      text: productText['zh-CN'].pages.intelligence.portal.dashboard
    })))
    await flush()

    expect(container.querySelector('[data-loading-state]')).not.toBeNull()
    expect(container.querySelector('[data-source-state]')).toBeNull()
    // 卡片自己的刷新在图还没回来时是「禁用」，那是动作的可用性，不是面板的终态；
    // 这里禁的是终态那一类，所以把动作按钮排除在外。
    expect(container.querySelector('[data-state="disabled"]:not(.icon-button), [data-state="error"]')).toBeNull()
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
      client: dashboardClient(), sentimentOptionsClient: sentimentOptionsClient(result), fundingRateClient: fundingRateClient(),
      openInterestClient: openInterestClient(), now: () => new Date(asOf),
      onConfigureSources: () => undefined, onManageSource: () => undefined,
      text: productText['zh-CN'].pages.intelligence.portal.dashboard
    })))
    await flush()

    // 状态句在「恐惧贪婪格」的读数行上（`data-sentiment-state`），不在仪表里；两态互斥，各说各的。
    const band = container.querySelector('.mi-crypto-dashboard__defensive-premium-row')!
    const row = band.querySelector('[data-half="fear-greed"] [data-sentiment-state]')!
    expect(row.getAttribute('data-sentiment-state')).toBe(expected)
    expect(row.closest('[data-sentiment-gauge]')).toBeNull()
    expect(band.querySelector('[data-sentiment-gauge] [data-sentiment-state]')).toBeNull()
    // 两态之间不许互串：空的只说「暂无读数」，读不到只说「暂时读不到」（文案都来自 i18n 键）。
    expect(row.textContent).toContain(expected === 'empty' ? text.dashboard.fearGreed.empty : text.data.temporarilyUnavailable)
    expect(row.textContent).not.toContain(expected === 'empty' ? text.data.temporarilyUnavailable : text.dashboard.fearGreed.empty)
  })

  it('puts the gauge column in the card and keeps funding history in its own band', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => root?.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), sentimentOptionsClient: sentimentOptionsClient({
        state: 'available', asOf, score: 22, bucket: 'extreme-fear', observedAt: '2026-08-04T10:00:00.000Z'
      }), fundingRateClient: fundingRateClient({
        state: 'available', asOf,
        btc: [{ observedAt: '2026-08-04T10:00:00.000Z', ratePercent: 0.01234 }],
        eth: [{ observedAt: '2026-08-04T11:00:00.000Z', ratePercent: -0.0031 }]
      }), openInterestClient: openInterestClient(), now: () => new Date(asOf), onConfigureSources: () => undefined,
      onManageSource: () => undefined, text: text.dashboard
    })))
    await flush()

    const band = container.querySelector('.mi-crypto-dashboard__defensive-premium-row')!
    const gauge = band.querySelector('[data-sentiment-gauge]')!
    // 仪表只此一副，住在卡的第一列；资金面与持仓两条带里都没有它。
    expect(container.querySelector('.mi-crypto-dashboard__capital-positioning-row [data-sentiment-gauge]')).toBeNull()
    expect(container.querySelector('.mi-crypto-dashboard__positioning-row [data-sentiment-gauge]')).toBeNull()
    expect(gauge.querySelector('[data-chart="gauge"]')).not.toBeNull()
    // 定版是 ECharts 仪表（用户 2026-11-22 看过手绘版后改口）：分数在盘里；档位词在**图下那一行**
    // （用户 2026-11-24：三个名字一起下移到各自图下），图里没有任何字，画布本身不进可访问树，
    // 读屏念的是那一句带分数的名字。
    const bucketWord = container.querySelector('[data-gauge-reading]')!
    expect(bucketWord.closest('.mi-defensive-premium__col-foot--gauge')).not.toBeNull()
    expect(bucketWord.textContent).toBe(text.dashboard.fearGreed.buckets['extreme-fear'])
    expect(bucketWord.getAttribute('aria-label')).toBe(`22 ${text.dashboard.fearGreed.buckets['extreme-fear']}`)
    expect(bucketWord.getAttribute('data-gauge-bucket-text')).toBe('extreme-fear')
    // 词在图下那一行、不在图位里：图位（`__chart-slot`）里一个文字节点都没有。
    expect(gauge.querySelector('.mi-defensive-premium__chart-slot [data-gauge-reading]')).toBeNull()
    expect(gauge.querySelector('.mi-defensive-premium__chart-slot [data-gauge-bucket-text]')).toBeNull()
    expect(gauge.querySelector('[data-chart="gauge"]')?.getAttribute('aria-hidden')).toBe('true')
    // 仪表只回答「落在哪一档」：日期在恐惧贪婪格的读数行上。
    expect(gauge.textContent).not.toContain('2026')
    // 「截至 X」不再写（用户 2026-11-22）：横轴末日期就是它，这一格连读数行都不渲染。
    expect(band.querySelector('[data-half="fear-greed"] .mi-defensive-premium__reading')).toBeNull()
    expect(band.textContent).not.toContain(text.dashboard.sentiment.observedAt)

    const rows = container.querySelectorAll('.mi-crypto-dashboard__positioning-row [data-funding-latest]')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('+0.0123%')
    expect(rows[0]?.textContent).toContain(text.dashboard.positioning.paymentDirections['long-pays-short'])
    expect(rows[1]?.textContent).toContain('-0.0031%')
    expect(rows[1]?.textContent).toContain(text.dashboard.positioning.paymentDirections['short-pays-long'])
    expect(band.textContent).not.toMatch(/58|conclusion|classification|https?:|sourceUrl|evidence|profile|health|credential|error/i)
  })

  it('gives the gauge a needle only when there is a reading, and always the same five bands', () => {
    const size = { width: 184, height: CHART_HEIGHT }
    // 有读数：指针、盘、盘里的分数都在，分数就是那个值（指针方向由 ECharts 按 0–100 算）。
    // 分数走 `graphic` 的 text（用户 2026-11-24：`detail` 会被盘盖住），所以这里断 graphic 里的那句字。
    for (const score of [0, 50, 100]) {
      const option = gaugeChartOption({ score, ...size, palette: CHART_PALETTE_FIXTURE, fonts: CHART_FONTS_FALLBACK })
      const series = (option.series as Array<{ pointer: { show: boolean }; data: Array<{ value: number }> }>)[0]!
      expect(series.pointer.show).toBe(true)
      expect(series.data[0]!.value).toBe(score)
      const graphic = option.graphic as Array<{ type: string; style?: { text?: string } }>
      expect(graphic.map(item => item.type)).toEqual(['circle', 'text'])
      expect(graphic[1]!.style!.text).toBe(String(score))
    }
    // 没有读数：指针、盘、分数都收起来，五段弧照旧。
    const blind = gaugeChartOption({ score: undefined, ...size, palette: CHART_PALETTE_FIXTURE, fonts: CHART_FONTS_FALLBACK })
    const series = (blind.series as Array<{ pointer: { show: boolean }; axisLine: { lineStyle: { color: unknown[] } } }>)[0]!
    expect(series.pointer.show).toBe(false)
    expect(blind.graphic).toEqual([])
    expect(series.axisLine.lineStyle.color).toHaveLength(5)
  })

  it('keeps the bucket word on the matching tone in all five bands', async () => {
    for (const [score, bucket] of [
      [12, 'extreme-fear'], [37, 'fear'], [50, 'neutral'], [60, 'greed'], [88, 'extreme-greed']
    ] as const) {
      const { band, dispose } = await renderSentimentGauge(score, bucket)
      const reading = band.querySelector('.mi-defensive-premium__col-foot--gauge [data-gauge-reading]')!
      expect(reading.getAttribute('data-gauge-bucket-text')).toBe(bucket)
      expect(reading.textContent).toBe(text.dashboard.fearGreed.buckets[bucket])
      expect(reading.getAttribute('aria-label')).toBe(`${score} ${text.dashboard.fearGreed.buckets[bucket]}`)
      await dispose()
    }
  })

  it('keeps one height variable for the chart row and one width for the gauge column', () => {
    const cardRule = cssBlock(styles, '.mi-defensive-premium {')
    // 图高与列宽各只有一处定义：这里、以及 ChartFrame 的 init 高度，两处必须相等。
    expect(cardRule).toContain(`--mi-defensive-premium-chart-height: ${CHART_HEIGHT}px`)
    expect(cardRule).toContain('--mi-defensive-premium-gauge-width: 184px')
    expect(cardRule).toContain('--mi-defensive-premium-column-gap: 8px')
    expect(cardRule).toContain('grid-template-columns: minmax(0, 1fr) var(--mi-defensive-premium-gauge-width) minmax(0, 1fr)')
    // 一列三道（用户 2026-11-23 删掉卡头与格名行之后）：图 168 / 说明 auto / 列尾留白 1fr。
    // 列里第一行就是图，图下才是名字行。把间距写成子元素外边距会溢出固定行、
    // 从行间隙里偷走高度——实测图底到分隔线只剩 2px，就是这个形状。
    expect(cssBlock(styles, '.mi-defensive-premium__col {'))
      .toContain('grid-template-rows: var(--mi-defensive-premium-chart-height) auto minmax(0, 1fr)')
    expect(cssBlock(styles, '.mi-defensive-premium__chart {')).toContain('align-self: end')
    expect(cssBlock(styles, '.mi-defensive-premium__chart {')).toContain('margin: 0')
    // 图与同类状态块钉在第 1 行（固定 168）：不钉的话，没有说明句的列会把图自动放进第 2 行，
    // 而列尾那条 1fr 会跑到图上面，把「图紧贴头栏」改成一大片留白。
    expect(cssBlock(styles, '.mi-defensive-premium__col > .mi-defensive-premium__state-box {'))
      .toContain('grid-row: 1')
    // 图下名字行落第 2 行（auto）、与图间距 6、行高 22（用户 2026-11-24）：0/1/2/3–29/满窗都只有
    // 这一行，各点数形态才等高。旧的那条「说明行」规则必须消失，否则 3–29 态又比满窗高一行。
    const footRule = cssBlock(styles, '.mi-defensive-premium__col > .mi-defensive-premium__col-foot {')
    expect(footRule).toContain('grid-row: 2')
    expect(footRule).toContain('margin-top: 6px')
    expect(footRule).toContain('min-height: 22px')
    // 整行居中（用户 2026-11-24）：三格的名字不再「名称贴左、值顶右」。四档间距见下面两条。
    expect(footRule).toContain('justify-content: center')
    expect(footRule).toContain('gap: 8px')
    expect(cssBlock(styles, '.mi-defensive-premium__col-foot-head {')).toContain('gap: 6px')
    // 带 `.col-foot` 前缀是有意的：基础那条 `gap: 6px` 写在后面，同权重会把 4 赢回去。
    expect(cssBlock(styles, '.mi-defensive-premium__col-foot .mi-defensive-premium__headline-tail--foot {'))
      .toContain('gap: 4px')
    // 居中考的那条 `margin-left: auto` 必须被盖掉，否则整组又被推回行末。
    expect(cssBlock(styles, '.mi-defensive-premium__col-foot .mi-defensive-premium__headline-tail {'))
      .toContain('margin-left: 0')
    expect(styles).not.toContain('.mi-defensive-premium__notes {')
    // 档位词在图下那一行、11/650、居中（用户 2026-11-24）：它不再绝对定位、也不再占卡头中轨。
    const bucketRule = cssBlock(styles, '.mi-defensive-premium__gauge-bucket {')
    expect(bucketRule).not.toContain('position: absolute')
    expect(bucketRule).not.toContain('bottom:')
    expect(bucketRule).toContain('text-align: center')
    expect(bucketRule).toContain('font-size: var(--font-meta)')
    expect(bucketRule).toContain('font-weight: 650')
    expect(cssBlock(styles, '.mi-defensive-premium__col-foot--gauge {'))
      .toContain('justify-content: center')
    expect(styles).not.toContain('.mi-defensive-premium__topbar-mid {')
    // 卡的行间收成 0 之后，结论句与图之间那 8（界面 2026-11-24 从 12 收到 8）落在它自己的外边距上。
    // `.mi-crypto-dashboard p { margin: 0 }` 权重更高，选择器不带 `>` 会被清成 0（探针里量到结论句紧贴图底 192）。
    expect(cssBlock(styles, '.mi-defensive-premium > .mi-defensive-premium__verdict {'))
      .toContain('margin: 8px 0 0')
  })

  it('fails closed instead of crashing when a legacy funding client has no history query', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => root?.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), sentimentOptionsClient: sentimentOptionsClient(),
      openInterestClient: openInterestClient(),
      fundingRateClient: { querySnapshot: () => Promise.resolve({ state: 'empty' }) }, now: () => new Date(asOf),
      onConfigureSources: () => undefined, onManageSource: () => undefined, text: text.dashboard
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
      client: dashboardClient(), sentimentOptionsClient: sentimentOptionsClient(), fundingRateClient: result === undefined ? { query: () => new Promise<never>(() => undefined) } : fundingRateClient(result), now: () => new Date(asOf),
      openInterestClient: openInterestClient(),
      onConfigureSources: () => undefined, onManageSource: () => undefined, text: text.dashboard
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
      client: dashboardClient(), sentimentOptionsClient: sentimentOptionsClient(), fundingRateClient: fundingRateClient(), openInterestClient: openInterestClient(), now: () => new Date(asOf),
      onConfigureSources: () => undefined, onManageSource: () => undefined, text: text.dashboard, cellEnabledIo
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
    const injectedClientImports = ['../../shared/ipc/cellEnabledClient', '../../shared/ipc/crossAssetObservationClient', '../../shared/ipc/dashboardFeedStatusClient', '../../shared/ipc/intelligenceSentimentOptionsCardClient', '../../shared/ipc/macroMarketSnapshotClient', '../../shared/ipc/macroRatesSnapshotClient', '../../shared/ipc/marketDivergenceClient']
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

  it('gives each band one owner: single-column money band, card band, positioning band', () => {
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
    // 资金面带只剩资金面自己，一列到底；旧的「情绪 | 资金面」1fr:4fr 与两个分配 token 一起删掉，
    // 断言反过来钉死：谁把它们加回来，这条就红。
    expect(rowRule).toContain('grid-template-columns: minmax(0, 1fr)')
    expect(styles).not.toContain('--mi-dashboard-positioning-sentiment-allocation')
    expect(styles).not.toContain('--mi-dashboard-positioning-funding-allocation')
    expect(stackStyles).not.toContain('.mi-crypto-dashboard__capital-positioning-row')
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
    // 这张卡的堆叠阈值是 939（三列下限 940），别的带子仍是 899。
    const stackStyles = cssBlock(styles, '@container (max-width: 939px)')

    expect(sentimentRule).toContain('container-type: inline-size')
    expect(sentimentRule).toContain('container-name: mi-sentiment-positioning')
    // 窄处堆叠作用在真网格上（三列变一列），不留「两半」那个已经不存在的别名类。
    expect(stackStyles).toContain('.mi-defensive-premium { grid-template-columns: minmax(0, 1fr); }')
    expect(styles).not.toContain('mi-defensive-premium__halves')
    expect(stackStyles).not.toContain('.mi-crypto-dashboard__capital-positioning-row > .mi-capital-conditions')
  })

  it('uses named compact rhythm inside the real data bands', () => {
    const dashboardRootRule = cssBlock(styles, '.mi-crypto-dashboard {')
    const rowRule = cssBlock(styles, '.mi-crypto-dashboard__capital-positioning-row {')
    const headerBandRule = cssBlock(styles, '.mi-capital-conditions__header-band {')
    const stableRule = cssBlock(styles, '.mi-capital-conditions__etf-col-asset {')

    expect(dashboardRootRule).toContain('--mi-dashboard-capital-header-row-gap')
    expect(dashboardRootRule).toContain('--mi-dashboard-capital-header-column-gap')
    expect(dashboardRootRule).toContain('--mi-dashboard-band-zone-inline')
    expect(rowRule).toContain('padding: var(--mi-dashboard-band-block-padding) 0')
    expect(headerBandRule).toContain('flex-wrap: wrap')
    expect(headerBandRule).toContain('gap: var(--mi-dashboard-capital-header-row-gap) var(--mi-dashboard-capital-header-column-gap)')
    expect(stableRule).toContain('width: 26%')
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
    // 整行卡自己三列并排：仪表盘 112 + 两个 1fr（定稿 §4.2），结论跨全宽。
    expect(cssBlock(styles, '.mi-defensive-premium {'))
      .toContain('grid-template-columns: minmax(0, 1fr) var(--mi-defensive-premium-gauge-width) minmax(0, 1fr)')
    // 列间距 8（界面 2026-11-24 从 12 收到 8）：1040 下两格 392，1326 下 535。
    expect(cssBlock(styles, '.mi-defensive-premium {')).toContain('column-gap: var(--mi-defensive-premium-column-gap)')
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
    expect(stackStyles).not.toContain('.mi-crypto-dashboard__capital-positioning-row')
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

  it('gives the money band to the capital panel alone and keeps the perpetual card in the next band', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), sentimentOptionsClient: sentimentOptionsClient(), fundingRateClient: fundingRateClient(), openInterestClient: openInterestClient(),
      capitalConditionsClient: capitalConditionsClient(), now: () => new Date(asOf), onConfigureSources: () => undefined,
      onManageSource: () => undefined, text: productText['en-US'].pages.intelligence.portal.dashboard
    } as never)))
    await flush()
    const row = container.querySelector<HTMLElement>('.mi-crypto-dashboard__capital-positioning-row')!
    const capital = row.querySelector<HTMLElement>('.mi-capital-conditions')!
    // 资金面带只剩资金面自己：仪表已经搬进上面那张整行卡，左列没有了。
    expect([...row.children].map((child) => child.className || child.tagName)).toEqual(['mi-capital-conditions'])
    const cardBand = container.querySelector<HTMLElement>('.mi-crypto-dashboard__defensive-premium-row')!
    expect(cardBand.querySelector('[data-sentiment-gauge]')).not.toBeNull()
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

  it('draws the gauge as five fear-to-greed bands, and colours the bucket word by band', () => {
    const option = gaugeChartOption({ score: 22, width: 184, height: CHART_HEIGHT, palette: CHART_PALETTE_FIXTURE, fonts: CHART_FONTS_FALLBACK })
    const series = (option.series as Array<{ axisLine: { lineStyle: { color: Array<[number, string]> } } }>)[0]!
    // 五段等宽：0–20 / 20–40 / 40–60 / 60–80 / 80–100，颜色依次从恐到贪。
    expect(series.axisLine.lineStyle.color.map(([stop]) => stop)).toEqual([0.2, 0.4, 0.6, 0.8, 1])
    expect(series.axisLine.lineStyle.color.map(([, color]) => color)).toEqual([...CHART_PALETTE_FIXTURE.bands])
    // 色带与档位词都取门户色板上的五个 token：module 里的兜底值必须与样式表一致（改一处就红）。
    const bands = ['extreme-fear', 'fear', 'neutral', 'greed', 'extreme-greed'] as const
    bands.forEach((band, index) => {
      expect(styles).toContain(`--mi-dashboard-sentiment-${band}: ${CHART_PALETTE_FIXTURE.bands[index]}`)
      expect(styles).toContain(`.mi-defensive-premium [data-gauge-bucket-text='${band}']`)
    })
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
      client: dashboardClient(), sentimentOptionsClient: sentimentOptionsClient(), fundingRateClient: fundingRateClient(), openInterestClient: openInterestClient(),
      now: () => new Date(asOf), onConfigureSources: () => undefined,
      onManageSource: () => undefined, text: text.dashboard,
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
      client: dashboardClient(), sentimentOptionsClient: sentimentOptionsClient(), fundingRateClient: fundingRateClient(), openInterestClient: openInterestClient(),
      now: () => new Date(asOf), onConfigureSources: () => undefined,
      onManageSource: () => undefined, text: text.dashboard,
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
      client: dashboardClient(), sentimentOptionsClient: sentimentOptionsClient(), fundingRateClient: fundingRateClient(), openInterestClient: openInterestClient(),
      now: () => new Date(asOf), onConfigureSources: () => undefined,
      onManageSource: () => undefined, text: text.dashboard
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
      client: dashboardClient(), sentimentOptionsClient: sentimentOptionsClient(), fundingRateClient: fundingRateClient(), openInterestClient: openInterestClient(),
      now: () => new Date(asOf), onConfigureSources: () => undefined,
      onManageSource: () => undefined, text: text.dashboard
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
type FearGreedSnapshot = FearGreedSnapshotResult
type OpenInterestResult = Awaited<ReturnType<DashboardProps['openInterestClient']['query']>>
type CapitalConditionsSnapshot = Awaited<ReturnType<NonNullable<DashboardProps['capitalConditionsClient']>['querySnapshot']>>

function dashboardClient(events: CalendarEvents = []): DashboardProps['client'] {
  return { queryMonth: async () => ({ state: 'available' as const, asOf, events }) }
}

function dashboardClientByMonth(eventsByMonth: Record<string, CalendarEvents>): DashboardProps['client'] {
  return { queryMonth: async ({ month }) => ({ state: 'available' as const, asOf, events: eventsByMonth[month] ?? [] }) }
}

/**
 * 卡上线后恐惧贪婪只从复合查询读（看板上一次请求两半）：旧快照夹具按同一份结果转成卡的左半，
 * 让原来那些「仪表显示什么」的用例继续对着同一份输入说话，只是走的门换了。
 */
function toCardFearGreed(result: FearGreedSnapshot): SentimentOptionsCardResult['fearGreed'] {
  if (result.state === 'empty') return { state: 'empty' }
  if (result.state === 'unavailable') return { state: 'unavailable', failureCode: 'fear-greed-query-unavailable' }
  return {
    state: 'available', score: result.score, bucket: result.bucket, observedAt: result.observedAt,
    latestDay: result.observedAt.slice(0, 10), daysAgo: 1, stale: false, seriesStart: '2025-08-05', points: []
  }
}

function sentimentOptionsClient(result: FearGreedSnapshot = { state: 'empty' as const, asOf }): NonNullable<DashboardProps['sentimentOptionsClient']> {
  return {
    query: async (input) => ({
      asOf: input.asOf, windowDays: 30, timeZone: input.timeZone,
      fearGreed: toCardFearGreed(result), optionSkew: { state: 'not-connected' }
    })
  }
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
    { sourceId: 'cryptoetf-etf-flows' as const, enabled: true, hasCredential: true }
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
      client: dashboardClient(), sentimentOptionsClient: sentimentOptionsClient(), fundingRateClient: fundingRateClient(),
      openInterestClient: openInterestClient(), now: () => new Date(asOf),
      dashboardFeedStatusClient: { query: async () => ({ state: 'available' as const, sources: allEnabled }) },
      onConfigureSources: () => undefined, onManageSource: () => undefined,
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

  /**
   * 源自己关掉（2026-11-11 03:00 用户现场）：两格都开着、币安那个源是关的。
   * 以前 `readable()` 把它压成 `false`，hook 落进「加载中」，卡片永远转圈。
   */
  it('source off: the positioning card names the source instead of waiting forever', async () => {
    const onManageSource = vi.fn()
    const container = await renderCells({}, {
      onManageSource,
      dashboardFeedStatusClient: { query: async () => ({ state: 'available' as const, sources: [
        { sourceId: 'binance-futures-positioning' as const, enabled: false, hasCredential: true },
        { sourceId: 'alternative-fear-greed' as const, enabled: true, hasCredential: true },
        { sourceId: 'defillama-stablecoins' as const, enabled: true, hasCredential: true },
        { sourceId: 'cryptoetf-etf-flows' as const, enabled: true, hasCredential: true }
      ] }) }
    })
    await settle(container, '.mi-positioning-panel')
    const card = container.querySelector('.mi-positioning-panel')!
    // 不许再拿「加载中」冒充：那是永远到不了的等待。
    expect(card.textContent).not.toContain(dashboardText.positioning.loading)
    // 说清是**哪个源**没启用（不是一句放之四海皆准的「未启用」）。
    expect(card.textContent).toContain(
      dashboardText.positioning.sourceDisabled.replace('{source}', dashboardText.positioning.sourceName)
    )
    // 两格都归纳到同一个源：整卡走「未启用」那一支，动作**只此一颗**（遮罩里那颗，标题行不再放第二颗）。
    const enable = [...card.querySelectorAll<HTMLButtonElement>('button')]
      .filter(button => button.textContent === dashboardText.positioning.enableData)
    expect(enable).toHaveLength(1)
    await act(async () => enable[0]!.click())
    expect(onManageSource).toHaveBeenCalledTimes(1)
  })

  /** 格自己关掉：说的是「这一格」，不许与上面那句「源没启用」混成同一句。 */
  it('cell off: the line is about the cell, not about the source', async () => {
    const container = await renderCells({ 'positioning:oi': false }, {
      dashboardFeedStatusClient: { query: async () => ({ state: 'available' as const, sources: [
        { sourceId: 'binance-futures-positioning' as const, enabled: true, hasCredential: true },
        { sourceId: 'alternative-fear-greed' as const, enabled: true, hasCredential: true },
        { sourceId: 'defillama-stablecoins' as const, enabled: true, hasCredential: true },
        { sourceId: 'cryptoetf-etf-flows' as const, enabled: true, hasCredential: true }
      ] }) }
    })
    await settle(container, '.mi-positioning-panel')
    const card = container.querySelector('.mi-positioning-panel')!
    // 一格关了：那一格自己说，卡不会整张变成「源没有启用（Binance …）」。
    // 只关一格：卡片骨架照常，那一格自己的行里带**这一格的名字**（「持仓名义额 …」）；
    // 整卡不会换成那句「来源没有启用（…）」。两句话共用一句文案是面板的设计，区别在层级：
    // 一格 → 行；两格 + 源关 → 整卡遮罩（下面那条用例）。
    expect(card.querySelector('.mi-source-veil')).toBeNull()
    expect(card.textContent).toContain(dashboardText.positioning.notional)
    expect(card.textContent).not.toContain(dashboardText.positioning.loading)
  })

  /**
   * 整类问题的其余两处（2026-11-12 03:5x 用户现场「ETF 那格开着、源关掉了」）：
   * `isCellEnabled` 只看得见「格开没开」，源级状态被压掉，卡片只能画红边。
   */
  it('capital: a cell whose SOURCE is off names the source; a cell that is off names the cell', async () => {
    const sourceOff = await renderCells({}, {
      dashboardFeedStatusClient: { query: async () => ({ state: 'available' as const, sources: [
        { sourceId: 'defillama-stablecoins' as const, enabled: true, hasCredential: true },
        { sourceId: 'cryptoetf-etf-flows' as const, enabled: false, hasCredential: true },
        { sourceId: 'alternative-fear-greed' as const, enabled: true, hasCredential: true }
      ] }) }
    })
    await settle(sourceOff, '.mi-capital-conditions')
    const capitalCard = sourceOff.querySelector('.mi-capital-conditions')!
    // 源关了：宿主把**源名**交给卡片（`cellAvailability.etf.sourceLabel`），不再是「这一格关了」；
    // 但卡片现在这一支只画横杠+一颗「启用数据」，**不打印**这个 label —— 让屏幕说出源名要改资金面的卡
    // （`CapitalConditionsPanel`，资金情绪线），已报 Chief 协调。这里钉宿主这一半：动作在、不加载。
    expect(capitalCard.querySelectorAll('button').length).toBeGreaterThan(0)
    expect(capitalCard.textContent).not.toContain(dashboardText.capitalConditions.loading)

    const cellOff = await renderCells({ 'capital:etf': false }, {
      dashboardFeedStatusClient: { query: async () => ({ state: 'available' as const, sources: [
        { sourceId: 'defillama-stablecoins' as const, enabled: true, hasCredential: true },
        { sourceId: 'cryptoetf-etf-flows' as const, enabled: true, hasCredential: true },
        { sourceId: 'alternative-fear-greed' as const, enabled: true, hasCredential: true }
      ] }) }
    })
    await settle(cellOff, '.mi-capital-conditions')
    const offCard = cellOff.querySelector('.mi-capital-conditions')!
    // 格关了：说这一格（格名 ETF），不说成源。
    expect(offCard.textContent).toContain('ETF')
    expect(offCard.textContent).not.toContain(productText['zh-CN'].settings.intelligenceSources.sourceNames['0xrouter-aggregate-provider'])
  })

  it('fear and greed: the veil names the source when the source itself is off', async () => {
    const container = await renderCells({}, {
      dashboardFeedStatusClient: { query: async () => ({ state: 'available' as const, sources: [
        { sourceId: 'alternative-fear-greed' as const, enabled: false, hasCredential: true },
        { sourceId: 'defillama-stablecoins' as const, enabled: true, hasCredential: true }
      ] }) }
    })
    // 状态句在「恐惧贪婪格」的读数行上：那一格点名是哪个源关着，仪表只画弧与刻度。
    await settle(container, '.mi-defensive-premium [data-half="fear-greed"] [data-sentiment-state]')
    const cell = container.querySelector('.mi-defensive-premium [data-half="fear-greed"]')!
    expect(cell.textContent).toContain(productText['zh-CN'].settings.intelligenceSources.sourceNames['alternative-fear-greed'])
    // 页面上只有一副仪表；源关着时那一列只有弧，没有分数与档位词。
    expect(container.querySelectorAll('[data-sentiment-gauge]')).toHaveLength(1)
    expect(container.querySelector('[data-sentiment-gauge] [data-gauge-reading]')).toBeNull()
  })

  /** 市场状态表逐行也要点名（2026-11-12 第二处残留）：源关了说源，格关了说格。 */
  it('market status rows name the source when it is off, and the cell when the cell is off', async () => {
    const sourceOff = await renderCells({}, {
      crossAssetClient: {
        acquire: async () => ({ state: 'active' as const, leaseId: 'lease-1' }),
        renew: async () => ({ state: 'active' as const }),
        release: async () => undefined,
        refresh: vi.fn(async () => ({ state: 'accepted' as const })),
        query: async () => ({ state: 'unavailable' as const, cause: 'query' as const })
      },
      dashboardFeedStatusClient: { query: async () => ({ state: 'available' as const, sources: [
        { sourceId: 'binance-futures-positioning' as const, enabled: false, hasCredential: true },
        { sourceId: 'realmarketapi-market' as const, enabled: true, hasCredential: true },
        { sourceId: 'fred-rates-liquidity' as const, enabled: true, hasCredential: true },
        { sourceId: 'alternative-fear-greed' as const, enabled: true, hasCredential: true }
      ] }) }
    })
    await settle(sourceOff, '[data-status-row="btc"] [data-source-state]')
    const btcRow = sourceOff.querySelector('[data-status-row="btc"]')!
    // 源关了：这一行报**源名**（Binance 合约持仓），不是笼统的「数据未被启用」。
    expect(btcRow.textContent).toContain(productText['zh-CN'].settings.intelligenceSources.sourceNames['binance-futures-positioning'])
    expect(btcRow.textContent).not.toBe(dashboardText.cellState.notEnabled)

    const cellOff = await renderCells({ 'quotes:btc': false }, {
      crossAssetClient: {
        acquire: async () => ({ state: 'active' as const, leaseId: 'lease-1' }),
        renew: async () => ({ state: 'active' as const }),
        release: async () => undefined,
        refresh: vi.fn(async () => ({ state: 'accepted' as const })),
        query: async () => ({ state: 'unavailable' as const, cause: 'query' as const })
      },
      dashboardFeedStatusClient: { query: async () => ({ state: 'available' as const, sources: [
        { sourceId: 'binance-futures-positioning' as const, enabled: true, hasCredential: true },
        { sourceId: 'realmarketapi-market' as const, enabled: true, hasCredential: true },
        { sourceId: 'fred-rates-liquidity' as const, enabled: true, hasCredential: true },
        { sourceId: 'alternative-fear-greed' as const, enabled: true, hasCredential: true }
      ] }) }
    })
    // 格关了：这一行说**这一格**（格名 BTC），不说成源的问题。
    const offRow = cellOff.querySelector('[data-status-row="btc"]')
    if (offRow !== null) {
      expect(offRow.textContent).not.toContain(productText['zh-CN'].settings.intelligenceSources.sourceNames['binance-futures-positioning'])
      expect(offRow.getAttribute('data-source-state')).toBe('disabled')
    }
  })

  /** 政策路径：两条硬依赖，逐支点名（2026-11-12 架构师批的双格形状）。 */
  /**
   * 政策那一块的说明与动作，**由钟表卡接管**（旧 `PolicyPathSlot` 已删，2026-11-15）：
   * 句子仍由宿主按原来那三支判断算出，只是渲染在钟表卡的政策行里；动作仍是同一条设置入口。
   */
  const policyCard = (container: HTMLElement): HTMLElement => container.querySelector('.mi-clock')!
  const policySentence = (container: HTMLElement): string =>
    policyCard(container).querySelector('.mi-clock__policy-note > span')?.textContent?.trim() ?? ''
  const policyAction = (container: HTMLElement): HTMLButtonElement =>
    policyCard(container).querySelector<HTMLButtonElement>('.mi-clock__policy-action')!

  /** 两格的源都启用：这样「另一格」的判定才是 read，单格关掉才看得出点名。 */
  const policySourcesOn = { query: async () => ({ state: 'available' as const, sources: [
    { sourceId: 'policy-path-market' as const, enabled: true, hasCredential: true },
    { sourceId: 'macro-calendar-fed' as const, enabled: true, hasCredential: true },
    { sourceId: 'alternative-fear-greed' as const, enabled: true, hasCredential: true }
  ] }) }

  it('policy path: both cells on but the read fails says unreadable with a retry — never "not enabled"', async () => {
    // 第 1 支：两格都去读。这次没读到（页面用例里 `policyPathClient` 没接）→ 只说「读不到 + 再试一次」，
    // 不许说成「未启用」——那是把「拿不到」和「没有」混成一句。
    const container = await renderCells({}, { dashboardFeedStatusClient: policySourcesOn })
    await settle(container, '.mi-clock__policy-note, .mi-clock')
    const sentence = policySentence(container)
    expect(sentence).not.toBe(dashboardText.policyPath.probabilityCellOff)
    expect(sentence).not.toBe(dashboardText.policyPath.fedCellOff)
    expect(sentence).not.toBe(dashboardText.policyPath.bothCellsOff)
    // 读不到这一支给的是重试，不是「去启用」。
    expect(policyAction(container).textContent).toBe(productText['zh-CN'].pages.intelligence.portal.data.retry)
  })

  it('policy path: only the probability cell off names that cell, not the calendar', async () => {
    const onManageSource = vi.fn()
    const container = await renderCells({ 'policy-path:probability': false }, { onManageSource, dashboardFeedStatusClient: policySourcesOn })
    await settle(container, '.mi-clock__policy-note, .mi-clock')
    expect(policySentence(container)).toBe(dashboardText.policyPath.probabilityCellOff)
    expect(policySentence(container)).not.toContain(dashboardText.policyPath.fedCellOff)
    await act(async () => policyAction(container).click())
    expect(onManageSource).toHaveBeenCalledWith({ business: 'dashboard', moduleKey: 'policy-path', cellId: 'policy-path:probability' })
  })

  it('policy path: only the Fed calendar off names the calendar, and never blames the odds', async () => {
    const onManageSource = vi.fn()
    const container = await renderCells({ 'policy-path:fed': false }, { onManageSource, dashboardFeedStatusClient: policySourcesOn })
    await settle(container, '.mi-clock__policy-note, .mi-clock')
    expect(policySentence(container)).toBe(dashboardText.policyPath.fedCellOff)
    expect(policySentence(container)).not.toContain(dashboardText.policyPath.probabilityCellOff)
    await act(async () => policyAction(container).click())
    expect(onManageSource).toHaveBeenCalledWith({ business: 'dashboard', moduleKey: 'policy-path', cellId: 'policy-path:fed' })
  })

  it('policy path: both cells off is one sentence naming both, with one configure action', async () => {
    const onConfigureSources = vi.fn()
    const container = await renderCells({ 'policy-path:probability': false, 'policy-path:fed': false }, { onConfigureSources, dashboardFeedStatusClient: policySourcesOn })
    await settle(container, '.mi-clock__policy-note, .mi-clock')
    expect(policySentence(container)).toBe(dashboardText.policyPath.bothCellsOff)
    // 不许拆成两条缺项
    expect(policyCard(container).querySelectorAll('.mi-clock__policy-note')).toHaveLength(1)
    await act(async () => policyAction(container).click())
    expect(onConfigureSources).toHaveBeenCalledTimes(1)
  })

  it('policy path: a cell whose SOURCE is switched off names the source, not "this cell is off"', async () => {
    const container = await renderCells({}, {
      dashboardFeedStatusClient: { query: async () => ({ state: 'available' as const, sources: [
        { sourceId: 'policy-path-market' as const, enabled: false, hasCredential: true },
        { sourceId: 'macro-calendar-fed' as const, enabled: true, hasCredential: true },
        { sourceId: 'alternative-fear-greed' as const, enabled: true, hasCredential: true }
      ] }) }
    })
    await settle(container, '.mi-clock__policy-note, .mi-clock')
    const sentence = policySentence(container)
    // 指向源（FOMC 决议市场），不是「这一格没启用」。
    expect(sentence).toContain('FOMC 决议市场')
    expect(sentence).not.toBe(dashboardText.policyPath.probabilityCellOff)
    expect(sentence).not.toBe(dashboardText.policyPath.fedCellOff)
    expect(policyAction(container)).not.toBeNull()
  })

  it('cell off: the sentiment card keeps its figure, drops the needle, and offers one enable action', async () => {
    const onManageSource = vi.fn()
    const container = await renderCells({ 'fear-greed:index': false }, {
      sentimentOptionsClient: { query: async (input: { asOf: string; timeZone: string }) => ({
        asOf: input.asOf, windowDays: 30 as const, timeZone: input.timeZone,
        fearGreed: { state: 'available' as const, score: 22, bucket: 'fear' as const, observedAt: '2026-08-04T00:00:00.000Z', latestDay: '2026-08-04', daysAgo: 1, stale: false, seriesStart: '2025-08-05', points: fgPoints(30) },
        optionSkew: { state: 'unavailable' as const, failureCode: 'option-skew-query-unavailable' as const }
      }) },
      onManageSource
    })
    await settle(container, '[data-half="fear-greed"] [data-sentiment-state]')
    const gauge = container.querySelector('[data-sentiment-gauge]')!
    const cell = container.querySelector('.mi-defensive-premium [data-half="fear-greed"]')!
    // 格名只有格名（用户 2026-11-22：量程就在刻度上，不再后缀）；它现在挂在**图下那一行**（用户 2026-11-24）。
    expect(container.querySelector('.mi-defensive-premium__col-foot[data-half-foot="fear-greed"] h3')?.textContent)
      .toBe(dashboardText.defensivePremium.fearGreed.name)
    expect(cell.querySelector('h3')).not.toBeNull()
    // 仪表还在（弧照画），但没有档位词——指针与分数都不指向一个关掉的格子。
    expect(gauge.querySelector('[data-chart="gauge"]')).not.toBeNull()
    expect(gauge.querySelector('[data-gauge-reading]')).toBeNull()
    const row = cell.querySelector('[data-sentiment-state]')!
    expect(row.getAttribute('data-sentiment-state')).toBe('disabled')
    expect(row.textContent).toContain(`${dataText.sourcesNotEnabled}（恐惧与贪婪）`)
    // 行内不放按钮：动作统一在卡标题行（AC-31），这里只有「去启用」那一颗。
    expect([...row.querySelectorAll('button')]).toHaveLength(0)
    const band = container.querySelector('.mi-crypto-dashboard__defensive-premium-row')!
    const enable = band.querySelector('.mi-defensive-premium__source-action') as HTMLButtonElement
    expect(enable.textContent).toBe(dataText.enableSources)
    // 一颗动作：标题行除 ⓘ 外只有它（AC-31）。
    const headerActions = [...band.querySelectorAll('.mi-defensive-premium__topbar-actions > button')]
      .filter(button => button.getAttribute('aria-label') !== dashboardText.defensivePremium.titleInfoLabel)
    expect(headerActions).toHaveLength(1)
    expect(gauge.textContent).not.toContain('22')
    expect(band.querySelector('.state-view')).toBeNull()
    // 关掉的那一半不画曲线，旧的也不画。
    expect(band.querySelector('[data-half="fear-greed"] [data-chart="fear-greed"]')).toBeNull()
    expect(band.querySelector('[data-half="fear-greed"] [data-chart-placeholder]')).toBeNull()
    await act(async () => enable.click())
    expect(onManageSource).toHaveBeenCalledTimes(1)
  })

  it('shows exactly one header action when the half is off and the other is not connected', async () => {
    const container = await renderCells({ 'fear-greed:index': false }, {})
    const band = container.querySelector('.mi-crypto-dashboard__defensive-premium-row')!
    const actions = [...band.querySelectorAll('.mi-defensive-premium__topbar-actions > button')]
      .filter(button => button.getAttribute('aria-label') !== dashboardText.defensivePremium.titleInfoLabel)
    // 未接入优先于被关掉：只出「查看来源」，不再同时出刷新或去启用。
    expect(actions.map(button => button.textContent)).toEqual([dashboardText.defensivePremium.action.viewSource])
  })

  it('read failure: one row under the figure says temporarily unreadable, with one retry', async () => {
    const container = await renderCells({}, {
      sentimentOptionsClient: sentimentOptionsClient({ state: 'unavailable', failureCode: 'fear-greed-query-unavailable' } as never)
    })
    await settle(container, '[data-half="fear-greed"] [data-sentiment-state]')
    const gauge = container.querySelector('[data-sentiment-gauge]')!
    const row = container.querySelector('[data-half="fear-greed"] [data-sentiment-state]')!
    expect(row.getAttribute('data-sentiment-state')).toBe('unreadable')
    expect(row.textContent).toContain(dataText.temporarilyUnavailable)
    // 行内不再有「再试一次」；重试就是标题行那颗刷新。
    expect([...row.querySelectorAll('button')]).toHaveLength(0)
    const refresh = container.querySelector('.mi-crypto-dashboard__defensive-premium-row')!
      .querySelector('.mi-defensive-premium__refresh')
    expect(refresh?.getAttribute('aria-label')).toBe(dashboardText.defensivePremium.action.refresh)
    expect(dataText.retry).not.toBe('')
    // 仪表仍画着弧，但没有读数；旧的整块 `StateView` 也不回来。
    expect(gauge.querySelector('[data-chart="gauge"]')).not.toBeNull()
    expect(gauge.querySelector('[data-gauge-reading]')).toBeNull()
    expect(container.querySelector('.mi-crypto-dashboard__defensive-premium-row .state-view')).toBeNull()
  })

  it('cell on and readable: the gauge shows its reading, and no state row', async () => {
    const container = await renderCells({}, { sentimentOptionsClient: sentimentOptionsClient(readableSentiment as never) })
    await settle(container, '[data-gauge-reading]')
    const gauge = container.querySelector('[data-sentiment-gauge]')!
    // 有数据时没有那一行：状态句只在没读数时出现。
    expect(gauge.querySelector('[data-sentiment-state]')).toBeNull()
    // 档位词在仪表列图下那一行（用户 2026-11-24），图位里没有字。
    expect(container.querySelector('.mi-defensive-premium__col-foot--gauge [data-gauge-reading]')?.textContent)
      .toBe(dashboardText.fearGreed.buckets['extreme-fear'])
    expect(gauge.querySelector('.mi-defensive-premium__chart-slot [data-gauge-reading]')).toBeNull()
    expect(gauge.querySelector('[data-chart="gauge"]')).not.toBeNull()
  })
})

/** 源日标签：只看日期，不引入时区。 */
function dayBefore(day: string, offset: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - offset * 86_400_000).toISOString().slice(0, 10)
}

function fgPoints(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    day: dayBefore('2026-08-04', index), observedAt: `${dayBefore('2026-08-04', index)}T00:00:00.000Z`,
    score: 40 + index, bucket: 'neutral' as const
  }))
}

function skewPoints(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    day: dayBefore('2026-08-04', index), observedAt: `${dayBefore('2026-08-04', index)}T00:00:00.000Z`,
    riskReversal: 1.2 + index / 10
  }))
}

describe('the defensive premium band', () => {
  const dashboardText = productText['zh-CN'].pages.intelligence.portal.dashboard

  /** 偏斜还没接入时的复合查询结果：左半有读数、右半是「未接入」，结论走降级句。 */
  const notConnectedSkew = {
    query: async (input: { asOf: string; timeZone: string }) => ({
      asOf: input.asOf,
      windowDays: 30 as const,
      timeZone: input.timeZone,
      fearGreed: {
        state: 'available' as const, score: 22, bucket: 'extreme-fear' as const,
        observedAt: '2026-08-04T10:00:00.000Z', latestDay: '2026-08-04', daysAgo: 1,
        stale: false, seriesStart: '2025-08-05', points: fgPoints(30)
      },
      optionSkew: { state: 'not-connected' as const }
    })
  }

  async function renderBand(client: unknown = notConnectedSkew, cells: Record<string, boolean> = {}): Promise<HTMLElement> {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), fundingRateClient: fundingRateClient(),
      openInterestClient: openInterestClient(), now: () => new Date(asOf),
      sentimentOptionsClient: client,
      ...(Object.keys(cells).length === 0 ? {} : { cellEnabledIo: { read: async () => cells } }),
      crossAssetClient: {
        acquire: async () => ({ state: 'active' as const, leaseId: 'lease-1' }),
        renew: async () => ({ state: 'active' as const }),
        release: async () => undefined,
        refresh: vi.fn(async () => ({ state: 'accepted' as const })),
        query: async () => ({ state: 'unavailable' as const, cause: 'query' as const })
      },
      onConfigureSources: () => undefined, onManageSource: () => undefined,
      text: dashboardText
    } as never)))
    await flush()
    return container
  }

  it('sits between the same-start return panel and the money band, as one full-width row', async () => {
    const container = await renderBand()
    const band = container.querySelector('.mi-crypto-dashboard__defensive-premium-row')!
    const crossAsset = container.querySelector('[data-cross-asset-workspace]')!
    const capital = container.querySelector('.mi-crypto-dashboard__capital-positioning-row')!
    const positioning = container.querySelector('.mi-crypto-dashboard__positioning-row')!

    // 位置：同起点收益率之后、资金面之前，而且是三带的兄弟节点——不许塞进某一带里当第二列。
    expect(band).not.toBeNull()
    expect(crossAsset.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(band.compareDocumentPosition(capital) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(capital.compareDocumentPosition(positioning) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(band.parentElement).toBe(capital.parentElement)

    // 整行卡：卡本体在带里，内容行是这张卡自己的三列（仪表盘 + 两格），结论独占一行。
    expect(band.querySelector('[data-testid="defensive-premium-card"]')).not.toBeNull()
    expect(band.querySelectorAll('.mi-defensive-premium__col')).toHaveLength(3)
    expect(band.querySelectorAll('.mi-defensive-premium__col[data-half]')).toHaveLength(2)
    // 页面上只此一副恐惧贪婪仪表：旧的并排格已经摘掉，不是两处各画一个。
    expect(container.querySelectorAll('[data-sentiment-gauge]')).toHaveLength(1)
    expect(band.querySelector('.mi-defensive-premium__topbar h2')?.textContent).toBe(dashboardText.defensivePremium.title)

    // 偏斜未接入：右半说「未接入」并给查看来源，不写成读不到。
    const skew = band.querySelector('.mi-defensive-premium__col[data-half="skew"]')!
    expect(skew.textContent).toContain(dashboardText.defensivePremium.skew.notConnected)
    expect(skew.textContent).not.toContain(productText['zh-CN'].pages.intelligence.portal.data.temporarilyUnavailable)
    // 「未接入」不许被当成坏数据：卡面不是整块错误态，左半的读数也照旧在。
    expect(band.querySelector('.state-view')).toBeNull()
    expect(band.querySelector('[data-verdict]')).not.toBeNull()
    // 仪表盘是独立的第一列，不在恐惧贪婪格里。
    expect(band.querySelector('.mi-defensive-premium__col[data-half="fear-greed"] [data-sentiment-gauge]')).toBeNull()
    expect(band.querySelector('[data-sentiment-gauge]')).not.toBeNull()
    // 「查看来源」是卡级动作、在头栏；那一格里唯一的按钮是图下名字行那颗半条 ⓘ，没有格内动作。
    expect([...skew.querySelectorAll('button')].map(button => button.getAttribute('aria-label')))
      .toEqual([dashboardText.defensivePremium.skew.infoLabel])
    expect([...band.querySelectorAll('.mi-defensive-premium__topbar-actions > button')].map(button => button.textContent))
      .toContain(dashboardText.defensivePremium.action.viewSource)

    // 左半画出 30 天走势，用自己的纵轴与可访问描述；偏斜未接入时那半不画图。
    const figure = band.querySelector('[data-chart="fear-greed"]')!
    expect(figure).not.toBeNull()
    const fearGreedAria = figure.getAttribute('aria-label') ?? ''
    expect(fearGreedAria).toContain(dashboardText.defensivePremium.chart.fearGreedAria)
    // 摘要要带窗口与首末值，不只是轴范围。
    expect(fearGreedAria).toContain('2026-08-04')
    expect(fearGreedAria).toContain(String(fgPoints(30)[29]!.score))
    // 轴名（含单位）来自文案键，画在 Y 轴顶端，不压在刻度行上。
    // 轴名不再画进图里（用户 2026-11-22 重排）：量程是行名后缀，单位在读数行。
    const axis = fearGreedChartOption({ points: fgPoints(30), palette: CHART_PALETTE_FIXTURE, fonts: CHART_FONTS_FALLBACK }).yAxis as { name?: string }
    expect(axis.name).toBeUndefined()
    // 两条线不共用一张图：未接入时右格不画图，只有左格那一张。
    expect(band.querySelector('[data-chart="skew"]')).toBeNull()
    expect(band.querySelectorAll('[data-chart="fear-greed"]')).toHaveLength(1)

    // 三颗 ⓘ 各说各的：卡头、左半、右半的读屏名互不相同（AC-44）。
    const halfInfoLabels = [...band.querySelectorAll('.mi-defensive-premium__col-foot button[aria-label]')]
      .map(button => button.getAttribute('aria-label'))
    expect(halfInfoLabels).toEqual([
      dashboardText.defensivePremium.fearGreed.infoLabel,
      dashboardText.defensivePremium.skew.infoLabel
    ])
    const cardInfoLabel = band.querySelector('.mi-defensive-premium__topbar-lead button[aria-label]')?.getAttribute('aria-label')
    expect(cardInfoLabel).toBe(dashboardText.defensivePremium.titleInfoLabel)
    expect(new Set([cardInfoLabel, ...halfInfoLabels]).size).toBe(3)

    // 结论在图下、跨全宽，按「恐惧档 + 偏斜缺失」查表，不在组件里拼句子。
    const verdict = band.querySelector('[data-verdict]')!
    expect(verdict.textContent).toBe(dashboardText.defensivePremium.verdict.fear.skewMissing)

    // 样式：带是整行一条；内容行三列（112 + 两个 1fr），窄处靠 minmax 收缩，不会挤成负宽。
    expect(cssBlock(styles, '.mi-crypto-dashboard__defensive-premium-row {')).not.toContain('grid-template-columns')
    expect(cssBlock(styles, '.mi-defensive-premium {'))
      .toContain('grid-template-columns: minmax(0, 1fr) var(--mi-defensive-premium-gauge-width) minmax(0, 1fr)')
    expect(cssBlock(styles, '.mi-defensive-premium {')).not.toContain('repeat(2')
  })

  it('keeps the card at the designed sizes: no source line, 184px gauge column, one 24px action', async () => {
    const container = await renderBand(skewClient({ kind: 'steeper' }))
    const band = container.querySelector('.mi-crypto-dashboard__defensive-premium-row')!
    // 卡上没有来源行：来源身份在卡头 ⓘ 与两格的行名上说。
    expect(band.querySelector('.mi-defensive-premium__provenance')).toBeNull()
    expect(band.textContent).not.toContain('Alternative.me')
    // 列宽与图高各只有一处定义（两个变量），三列都用它们。
    const cardRule = cssBlock(styles, '.mi-defensive-premium {')
    expect(cardRule).toContain('--mi-defensive-premium-gauge-width: 184px')
    expect(cardRule).toContain('--mi-defensive-premium-chart-height: 168px')
    expect(cardRule).toContain('--mi-defensive-premium-column-gap: 8px')
    // 标题行的动作与文字按钮同档（24）：图标按钮用 md，换态时不跳 2px。
    expect(band.querySelector('.mi-defensive-premium__refresh')?.className).toContain('icon-button--md')
    // 两条曲线各是一个 ECharts 容器，高度走同一个变量；图是 SVG renderer 画出来的。
    for (const chart of ['fear-greed', 'skew']) {
      const figure = band.querySelector(`[data-chart="${chart}"]`)!
      expect(figure).not.toBeNull()
      expect(figure.querySelector('svg')).not.toBeNull()
      expect(figure.querySelector('canvas')).toBeNull()
    }
  })

  it('sizes every canvas from its own column, never by borrowing another column', async () => {
    // 真机事故（用户 2026-11-22）：真实布局还没量到时仪表按曲线的 416 出了一张图，弧横着压到中列。
    // 判据：没有布局（happy-dom 的 clientWidth = 0）时，每张图用**本列**名义宽兜底——
    // 仪表 184（中列）、两侧走势各 420（1040 下： (1040 − 184 − 16) / 2）；416 不是任何一列的真实宽度。
    const container = await renderBand(skewClient({ kind: 'steeper' }))
    const width = (selector: string) => container.querySelector(selector)?.getAttribute('width')
    expect(width('[data-sentiment-gauge] svg')).toBe('184')
    expect(width('[data-half="fear-greed"] [data-chart="fear-greed"] svg')).toBe('420')
    expect(width('[data-half="skew"] [data-chart="skew"] svg')).toBe('420')
    expect(container.querySelectorAll('svg[width="416"]')).toHaveLength(0)
  })

  it('lays the content row out as three columns, with the conclusion spanning all of them', async () => {
    const container = await renderBand(skewClient({ kind: 'steeper' }))
    const card = container.querySelector('.mi-defensive-premium')!
    const children = [...card.children]
    const gauge = children.find(child => child.hasAttribute('data-sentiment-gauge') || child.querySelector('[data-sentiment-gauge]') !== null)!
    const fearGreed = children.find(child => child.getAttribute('data-half') === 'fear-greed')!
    const skew = children.find(child => child.getAttribute('data-half') === 'skew')!
    // 读者看到的顺序（用户 2026-11-22 定）：恐惧贪婪走势 → 仪表 → 偏斜走势；仪表是独立一列，不在任何一格里。
    expect(fearGreed.compareDocumentPosition(gauge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(fearGreed.compareDocumentPosition(skew) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(gauge.closest('[data-half]')).toBeNull()
    // 结论在三列之后，并且跨全宽（`grid-column: 1 / -1`）。
    const verdict = card.querySelector('[data-verdict]')!
    expect(skew.compareDocumentPosition(verdict) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(cssBlock(styles, '.mi-defensive-premium > .mi-defensive-premium__topbar,')).toContain('grid-column: 1 / -1')
    // 整卡没有读数行；右格的值与格名一起在图下那一行（用户 2026-11-24），名字在左、值在右端。
    expect(card.querySelectorAll('.mi-defensive-premium__reading')).toHaveLength(0)
    const skewHead = container.querySelector('.mi-defensive-premium__col-foot[data-half-foot="skew"]')!
    expect(skewHead.querySelector('[data-skew-value]')?.textContent).toBe('1.8')
    expect(skewHead.textContent).toContain(dashboardText.defensivePremium.skew.unit)
    expect(skewHead.querySelector('h3')?.textContent).toBe(dashboardText.defensivePremium.skew.name)
    // 头栏只剩四样（用户 2026-11-24）：卡名 + ⓘ + 窗口 + 一颗动作；两个格名不在头栏上。
    const topbar = card.querySelector('.mi-defensive-premium__topbar')!
    expect(topbar.querySelector('h2')?.textContent).toBe(dashboardText.defensivePremium.title)
    expect(topbar.querySelectorAll('h3')).toHaveLength(0)
    expect(topbar.textContent).toContain(dashboardText.defensivePremium.window)
    // 头栏三轨与三列同宽（1fr / 仪表 / 1fr），行高 24 由动作兜住——它不再单独占一行。
    const topbarRule = cssBlock(styles, '.mi-defensive-premium__topbar {')
    expect(topbarRule).toContain('grid-template-columns: minmax(0, 1fr) var(--mi-defensive-premium-gauge-width) minmax(0, 1fr)')
    expect(topbarRule).toContain('min-height: 24px')
    expect(cssBlock(styles, '.mi-defensive-premium {')).toContain('row-gap: 0')
    // 曲线高度是一个变量（`--mi-defensive-premium-chart-height`），三列共用，不再按比例算；
    // 间距（6 与 10）算在行高里，不让外边距溢出到行外。
    expect(cssBlock(styles, '.mi-defensive-premium__col {'))
      .toContain('grid-template-rows: var(--mi-defensive-premium-chart-height) auto minmax(0, 1fr)')
    // 图下名字行落在第 2 行：三列各一行、都不影响图的位置，所以三列的图底才齐平。
    expect(cssBlock(styles, '.mi-defensive-premium__col > .mi-defensive-premium__col-foot {'))
      .toContain('grid-row: 2')
  })

  function fearGreedSection(count = 30) {
    return {
      state: 'available' as const, score: 22, bucket: 'extreme-fear' as const,
      observedAt: '2026-08-04T00:00:00.000Z', latestDay: '2026-08-04', daysAgo: 1,
      stale: false, seriesStart: '2025-08-05', points: fgPoints(count)
    }
  }

  function skewClient(direction: unknown, count = 30) {
    return { query: async (input: { asOf: string; timeZone: string }) => ({
      asOf: input.asOf, windowDays: 30 as const, timeZone: input.timeZone,
      fearGreed: { state: 'available' as const, score: 22, bucket: 'extreme-fear' as const, observedAt: '2026-08-04T00:00:00.000Z', latestDay: '2026-08-04', daysAgo: 1, stale: false, seriesStart: '2025-08-05', points: fgPoints(30) },
      optionSkew: {
        state: 'available' as const,
        latest: { riskReversal: 1.8, observedAt: '2026-08-04T00:00:00.000Z', tenorDays: 30 as const, putIv25: 60, callIv25: 58.2, expiries: ['2026-09-04', '2026-10-04'] as const },
        direction, observedAt: '2026-08-04T00:00:00.000Z', latestDay: '2026-08-04', daysAgo: 1,
        stale: false, seriesStart: '2026-07-06', points: skewPoints(count)
      }
    }) }
  }

  it('keeps exactly one header action in all five states, the mixed ones included (AC-31)', async () => {
    const dataCopy = productText['zh-CN'].pages.intelligence.portal.data
    const headerActions = (container: HTMLElement) => [...container.querySelectorAll('.mi-defensive-premium__topbar-actions > button')]
      .filter(button => button.getAttribute('aria-label') !== dashboardText.defensivePremium.titleInfoLabel)
      .map(button => button.getAttribute('aria-label') ?? button.textContent)
    const refresh = dashboardText.defensivePremium.action.refresh
    const viewSource = dashboardText.defensivePremium.action.viewSource
    const readFailed = {
      query: async (input: { asOf: string; timeZone: string }) => ({
        asOf: input.asOf, windowDays: 30 as const, timeZone: input.timeZone,
        fearGreed: { state: 'unavailable' as const, failureCode: 'fear-greed-query-unavailable' as const },
        optionSkew: { state: 'not-connected' as const }
      })
    }

    // 正常（两条链路都可用）→ 刷新。
    expect(headerActions(await renderBand(skewClient({ kind: 'steeper' })))).toEqual([refresh])
    // 被关掉（偏斜读得到）→ 去启用。
    expect(headerActions(await renderBand(skewClient({ kind: 'steeper' }), { 'fear-greed:index': false }))).toEqual([dataCopy.enableSources])
    // 未接入、恐惧贪婪可读 → 查看来源。
    expect(headerActions(await renderBand())).toEqual([viewSource])
    // 未接入且恐惧贪婪读失败 → 只留刷新；「未接入」右半行内已经写着，不再给「查看来源」。
    const mixed = await renderBand(readFailed)
    expect(headerActions(mixed)).toEqual([refresh])
    expect(mixed.querySelector('[data-half="skew"]')?.textContent).toContain(dashboardText.defensivePremium.skew.notConnected)
    // 被关掉且未接入 → 未接入优先，只有查看来源。
    expect(headerActions(await renderBand(notConnectedSkew, { 'fear-greed:index': false }))).toEqual([viewSource])
  })

  it('names the premium direction when the fear-greed half simply has no reading (AC-12)', async () => {
    const emptyFearGreed = {
      query: async (input: { asOf: string; timeZone: string }) => ({
        asOf: input.asOf, windowDays: 30 as const, timeZone: input.timeZone,
        fearGreed: { state: 'empty' as const },
        optionSkew: {
          state: 'available' as const,
          latest: { riskReversal: 1.8, observedAt: '2026-08-04T00:00:00.000Z', tenorDays: 30 as const, putIv25: 60, callIv25: 58.2, expiries: ['2026-09-04', '2026-10-04'] as const },
          direction: { kind: 'steeper' as const }, observedAt: '2026-08-04T00:00:00.000Z', latestDay: '2026-08-04', daysAgo: 1,
          stale: false, seriesStart: '2026-07-06', points: skewPoints(30)
        }
      })
    }
    const band = (await renderBand(emptyFearGreed)).querySelector('.mi-crypto-dashboard__defensive-premium-row')!
    // 确实没有 ≠ 读不到：这一态不是整卡状态面，结论只说保费方向并指出缺恐惧贪婪，不写为什么缺。
    expect(band.querySelector('.state-view')).toBeNull()
    expect(band.querySelector('[data-verdict]')?.textContent).toBe(dashboardText.defensivePremium.verdict.fgMissing.steeper)
    // 读数尾巴（值 · 方向 · 窗口）在偏斜那一格图下名字行的右端（用户 2026-11-24），不在卡头里。
    expect(band.querySelector('.mi-defensive-premium__col-foot[data-half-foot="skew"]')?.textContent)
      .toContain(dashboardText.defensivePremium.skew.direction.steeper)
    expect(band.querySelector('.mi-defensive-premium__topbar')?.textContent)
      .not.toContain(dashboardText.defensivePremium.skew.direction.steeper)
  })

  it.each([
    ['insufficient', { kind: 'unknown', reason: 'insufficient' }],
    ['stale', { kind: 'unknown', reason: 'stale' }],
    ['discontinuous', { kind: 'unknown', reason: 'discontinuous' }]
  ] as const)('draws the skew line and names why the direction is %s', async (reason, direction) => {
    const container = await renderBand(skewClient(direction))
    const band = container.querySelector('.mi-crypto-dashboard__defensive-premium-row')!
    // 两张图各是一个 ECharts 容器，各自带读屏名；偏斜那张的轴名就是整句 `skew.axis`。
    const skewChart = band.querySelector('[data-chart="skew"]')!
    expect(skewChart).not.toBeNull()
    const skewAria = skewChart.getAttribute('aria-label') ?? ''
    expect(skewAria).toContain(dashboardText.defensivePremium.chart.skewAria)
    expect(skewAria).toContain('2026-08-04')
    expect(skewAria).toContain(skewPoints(30)[0]!.riskReversal.toFixed(1))
    expect(band.querySelectorAll('[data-chart="fear-greed"], [data-chart="skew"]')).toHaveLength(2)
    // 轴名不再画进图里（用户 2026-11-22 重排）：单位在读数行，图里没有那行字。
    const option = skewChartOption({
      points: skewPoints(30).map((point, index) => ({ day: point.day, observedAt: point.observedAt, riskReversal: point.riskReversal + index * 0 })),
      palette: CHART_PALETTE_FIXTURE,
      fonts: CHART_FONTS_FALLBACK
    })
    expect((option.yAxis as { name?: string }).name).toBeUndefined()
    expect(band.querySelector('.mi-defensive-premium__col-foot[data-half-foot="skew"] .mi-defensive-premium__headline-tail')?.textContent)
      .toContain(dashboardText.defensivePremium.skew.unit)

    // 「为什么没方向」只在结论行说一次（用户 2026-11-24）：图下不再有那句，说明行只报数量。
    expect(band.querySelector('[data-skew-direction]')).toBeNull()
    expect(band.querySelector('[data-verdict]')?.textContent).toBe(
      fillLabelParams(dashboardText.defensivePremium.verdict.fear.skewUnknown[reason], { date: '2026-08-04' })
    )
    // 同一件事只说一遍：整张卡里「还不够 5 天 / 数据停在 / 读数不连续」各只出现一次。
    const repeated = ['还不够 5 天', '偏斜数据停在', '偏斜读数不连续']
      .map(phrase => [phrase, band.textContent!.split(phrase).length - 1] as const)
      .filter(([, count]) => count > 0)
    expect(repeated.map(([phrase]) => phrase)).toHaveLength(1)
    expect(repeated[0]![1]).toBe(1)
  })

  it('says the count nowhere, and the reason once in the verdict', async () => {
    // 用户 2026-11-24：「从 2026-11-22 开始记录 · 还差 27 个读数」是废话，删掉；1–2 个读数那句
    // 「还在攒：已有 N 个读数，还差 M 个」是同一形状，一起删。原因只在结论里说一次。
    for (const count of [1, 2, 6, 30]) {
      const container = await renderBand(skewClient({ kind: 'unknown', reason: 'insufficient' }, count))
      const band = container.querySelector('.mi-crypto-dashboard__defensive-premium-row')!
      // 图下只有一行：偏斜那一列就两个孩子（图 + 名字行）。重新加回任何说明行都会让这条红——
      // 只断言某个 `data-*` 属性不存在是不够的，那属性源码里已经没有人发。
      expect(band.querySelector('[data-half="skew"]')!.children).toHaveLength(2)
      expect(band.textContent).not.toContain('还差')
      expect(band.textContent).not.toContain('开始记录')
      expect(band.textContent!.split('还不够 5 天').length - 1).toBe(1)
      expect(band.querySelector('[data-verdict]')?.textContent)
        .toBe(dashboardText.defensivePremium.verdict.fear.skewUnknown.insufficient)
    }
  })

  it('says the skew half is empty in its own words, not the fear-greed sentence', async () => {
    // 两半各说各的空态。借用 `text.empty`（恐惧贪婪那句）时，右半会显示「暂无已采集的恐惧与贪婪指数」——
    // 用户就是被这句张冠李戴的话当成「有数据但没显示」。
    const client = { query: async (input: { asOf: string; timeZone: string }) => ({
      asOf: input.asOf, windowDays: 30 as const, timeZone: input.timeZone,
      fearGreed: fearGreedSection(30),
      optionSkew: { state: 'empty' as const }
    }) }
    const container = await renderBand(client)
    const band = container.querySelector('.mi-crypto-dashboard__defensive-premium-row')!
    const skewColumn = band.querySelector('[data-half="skew"]')!
    const sentence = skewColumn.querySelector('[data-state="empty"]')!
    expect(sentence.textContent).toBe(dashboardText.defensivePremium.skew.empty)
    expect(sentence.textContent).not.toBe(dashboardText.fearGreed.empty)
    // 左半照常画它的曲线：空的是偏斜那半，不是整卡。
    expect(band.querySelector('[data-chart="fear-greed"]')).not.toBeNull()
    expect(skewColumn.querySelector('[data-chart="skew"]')).toBeNull()
  })

  it('fits the skew axis to the data instead of padding it to four fixed ticks', () => {
    // 第一版把间隔向下取整，上沿低于数据最大值，整条曲线被裁成一块填满的色块；
    // 改完又走了另一个极端：凑满四档把 12.8–13.2 撑到 12–15，曲线只占六分之一高。
    // 界面 2026-11-22 的判据：轴跨度 ≤ 数据跨度的 2 倍（不足 0.5 按 0.5），
    // 刻度间隔 ≤ 数据跨度的 1/2，上下界盖住数据但不为了凑档数撑开。
    for (const values of [[12.9], [12.8, 13.2], [12.6, 13.4], [12.7, 13.5], [12.9, 12.9, 12.9], [11.8, 13.2], [11.8, 15.0], [-4.2, 9.6], [40, 41]]) {
      const points = values.map((riskReversal, index) => ({
        day: new Date(Date.parse('2026-11-22T00:00:00.000Z') - index * 86_400_000).toISOString().slice(0, 10),
        observedAt: '2026-11-22T00:00:00.000Z',
        riskReversal
      }))
      const option = skewChartOption({ points, palette: CHART_PALETTE_FIXTURE, fonts: CHART_FONTS_FALLBACK })
      const yAxis = option.yAxis as { min: number; max: number; interval: number }
      const low = Math.min(...values)
      const high = Math.max(...values)
      const span = Math.max(high - low, 0.5)
      const ySeries = (option.series as Array<{ markLine?: { data: Array<{ yAxis: number }> } }>)[0]!
      const gridLines = ySeries.markLine!.data.map(entry => entry.yAxis)
      const ticks = gridLines.length + 1
      expect(yAxis.min).toBeLessThanOrEqual(low)
      expect(yAxis.max).toBeGreaterThanOrEqual(high)
      // 1–2 个读数走攒数阶段的固定窗（上下各留半档，间隔向上取到 0.2 的倍数，可能略超半跨度），
      // 「轴 ≤ 2 倍跨度 / 间隔 ≤ 半跨度」只对 3 个点起成立。
      if (values.length > 2) {
        expect(yAxis.max - yAxis.min).toBeLessThanOrEqual(span * 2 + 1e-9)
        expect(yAxis.interval).toBeLessThanOrEqual(span / 2 + 1e-9)
      } else {
        // 上界仍要盖住数据、下界仍要在下面：点落在框里，不压在轴上。
        expect(yAxis.min).toBeLessThan(low)
        expect(yAxis.max).toBeGreaterThan(high)
      }
      // 少于 3 个读数：点不许压在轴底/轴顶，也不许正好落在任何一条刻度线上（用户 2026-11-23）。
      if (values.length < 3) {
        for (const value of values) {
          expect(Math.abs(value - yAxis.min)).toBeGreaterThan(1e-6)
          expect(Math.abs(value - yAxis.max)).toBeGreaterThan(1e-6)
          for (const line of gridLines) expect(Math.abs(value - line)).toBeGreaterThan(1e-6)
        }
      }
      // 档数封顶 4，横虚线 = 档数 − 1（最上面那条边不画），而且线只落在刻度上。
      expect(ticks).toBeLessThanOrEqual(4)
      expect((option.yAxis as { splitLine: { show: boolean } }).splitLine.show).toBe(false)
      for (const line of gridLines) {
        expect(Math.abs(((line - yAxis.min) / yAxis.interval) - Math.round((line - yAxis.min) / yAxis.interval))).toBeLessThan(1e-6)
      }
    }
  })

  it('leaves half a tick of air around one or two readings, and leaves 3+ tick patterns alone', () => {
    const seriesOf = (values: number[]) => values.map((riskReversal, index) => ({
      day: new Date(Date.parse('2026-11-22T00:00:00.000Z') - index * 86_400_000).toISOString().slice(0, 10),
      observedAt: '2026-11-22T00:00:00.000Z',
      riskReversal
    }))
    const fitOf = (values: number[]) => {
      const option = skewChartOption({ points: seriesOf(values), palette: CHART_PALETTE_FIXTURE, fonts: CHART_FONTS_FALLBACK })
      const y = option.yAxis as { min: number; max: number; interval: number }
      const lines = (option.series as Array<{ markLine?: { data: Array<{ yAxis: number }> } }>)[0]!.markLine!.data.map(entry => entry.yAxis)
      return { y, lines }
    }
    // 2 个读数（8.0 / 10.4）：间隔 = 跨度 ÷ 2 向上取到 0.2 的倍数 = 1.2，轴 7.4–11.0；
    // 两个点各离最近刻度 0.6，最下面那个点离轴底也是 0.6——不再压在 8 那条线上（用户 2026-11-23）。
    const two = fitOf([8.0, 10.4])
    expect(two.y).toMatchObject({ min: 7.4, max: 11, interval: 1.2 })
    expect(two.lines).toEqual([7.4, 8.6, 9.8])
    // 1 个读数：间隔 0.4、轴 = 值 ∓0.6，点在正中、离最近刻度 0.2。
    const one = fitOf([13.2])
    expect(one.y).toMatchObject({ min: 12.6, max: 13.8, interval: 0.4 })
    expect(one.lines).toEqual([12.6, 13, 13.4])

    // 边界：跨度正好 1.5 个间隔时，高点会落在最后一条刻度线上（跨度 0.3 / 0.6，`Math.round(2.5)` 恒取 3）。
    // 撞上就把间隔加一档，点退到两线之间、离最近刻度 0.25 个间隔（界面 2026-11-23 指出的边界）。
    for (const [low, high] of [[13.0, 13.3], [13.0, 13.6]]) {
      const edge = fitOf([low, high])
      for (const value of [low, high]) {
        expect(Math.abs(value - edge.y.min)).toBeGreaterThan(1e-6)
        for (const line of edge.lines) expect(Math.abs(value - line)).toBeGreaterThan(1e-6)
        const position = (value - edge.y.min) / edge.y.interval
        expect(Math.abs(position - Math.round(position))).toBeGreaterThanOrEqual(0.25 - 1e-9)
      }
    }

    // 3 个点起一个数都不许动：满窗 11.8–15.0 仍是 11.6 / 12.8 / 14 / 15.2 四档三条虚线。
    const full = fitOf(Array.from({ length: 30 }, (_, index) => 11.8 + (15 - 11.8) * index / 29))
    expect(full.y).toMatchObject({ min: 11.6, max: 15.2, interval: 1.2 })
    expect(full.lines).toEqual([11.6, 12.8, 14])
  })

  it('keeps the 5-reading skew curve tall: 12.8–13.2 gets an axis no wider than 1.0', () => {
    // 这张图的读者判断「走阔还是收窄」靠曲线斜率，轴一撑开斜率就被压平了。
    const values = [12.8, 13.0, 12.9, 13.1, 13.2]
    const points = values.map((riskReversal, index) => ({
      day: new Date(Date.parse('2026-11-22T00:00:00.000Z') - index * 86_400_000).toISOString().slice(0, 10),
      observedAt: '2026-11-22T00:00:00.000Z',
      riskReversal
    }))
    const option = skewChartOption({ points, palette: CHART_PALETTE_FIXTURE, fonts: CHART_FONTS_FALLBACK })
    const yAxis = option.yAxis as { min: number; max: number; interval: number }
    expect(yAxis.max - yAxis.min).toBeLessThanOrEqual(1)
    expect(yAxis.interval).toBeLessThanOrEqual(0.25)
    // 数据至少占到轴高的一半，否则又回到「一条平线」。
    expect((13.2 - 12.8) / (yAxis.max - yAxis.min)).toBeGreaterThanOrEqual(0.5 - 1e-9)
  })

  it('stacks below 940 and caps the gauge there, so nothing folds into the next track', () => {
    // 三列下限 = 184 + 24 + 2×366 = 940：再窄一格英文读数折两行（41 > 24 的读数轨）压进图行。
    const stacked = cssBlock(styles, '@container (max-width: 939px) {')
    expect(stacked).toContain('.mi-defensive-premium { grid-template-columns: minmax(0, 1fr); }')
    // 这张卡只在 939 以下堆叠；899 那条留给别的带子，不许再管这张卡（900–939 必须已经堆叠）。
    const legacy = cssBlock(styles, '@container (max-width: 899px) {')
    expect(legacy).not.toContain('.mi-defensive-premium')
    // 堆叠后仪表独占一行：不限宽会被拉成 800×168 的扁半圆。
    expect(stacked).toContain('.mi-defensive-premium__col--gauge { width: min(184px, 100%); justify-self: center; }')
  })

  it('leaves the fear-greed chart exactly as it was before the skew rework', () => {
    // 用户 2026-11-22：这一半本来就是现成的，不该被偏斜的新规矩带着改。它有自己的网格与横轴，
    // 与偏斜不共用坐标轴配置——这里钉住三条事实，防止下次再被顺手改到。
    // 夹具必须**少于 30 个点**：拿 30 点的样例断言长度 30，「跟着数据走」和「钉死 30 天窗口」
    // 都会得到 30，那条断言对两种实现都成立，等于没守（架构师 2026-11-22 复核指出是假绿）。
    const points = fearGreedSection(5).points
    const option = fearGreedChartOption({
      points,
      palette: CHART_PALETTE_FIXTURE, fonts: CHART_FONTS_FALLBACK
    })
    // 上留白 34 → 12（2026-11-22 重排：量程挪进行名，图里不再有那行字）；
    // 下留白 26 → 24，与偏斜那张一致：两张图的日期行才在同一条线上（Chief 2026-11-23 量到差 4px）。
    // 右留白 28 → 16（界面 2026-11-24）：这张图右边没有刻度，只剩末位日期居中要约 15，28 那一截是白留的。
    expect(option.grid).toMatchObject({ left: 32, right: 16, top: 12, bottom: 24 })
    // 两张图的右留白**不再同一套**：偏斜那张左边要留 32 给 `10.4` 这种四字符标签、右边仍是 28。
    // 同线判据只剩「左 + 下」——日期行对齐靠 bottom，左右两边的刻度需求本来就不同。
    const skewGrid = skewChartOption({ points: skewPoints(30), palette: CHART_PALETTE_FIXTURE, fonts: CHART_FONTS_FALLBACK })
      .grid as { left: number; right: number; bottom: number }
    expect(skewGrid).toMatchObject({ left: 32, right: 28, bottom: 24 })
    expect(skewGrid.bottom).toBe((option.grid as { bottom: number }).bottom)
    expect(skewGrid.left).toBe((option.grid as { left: number }).left)
    // 净绘图宽（1040 下每格 420）：左 420 − 32 − 16 = 372、右 420 − 32 − 28 = 360。
    expect(420 - 32 - (option.grid as { right: number }).right).toBe(372)
    expect(420 - skewGrid.left - skewGrid.right).toBe(360)
    // 横轴跟着数据走（不是钉住 30 天的窗口）：5 个读数就只印 5 个刻度，首日就是数据最早那天。
    const axis = (option.xAxis as { data: string[]; axisLabel: { interval: (index: number) => boolean } }).data
    expect(axis).toHaveLength(5)
    expect(axis[0]).toBe(points[4]!.day)
    // 末点日期必须印出来（读数写「截至 X」，轴上不能停在 X 的前一天）。
    const labelShown = (option.xAxis as { axisLabel: { interval: (index: number) => boolean } }).axisLabel.interval
    expect(labelShown(4)).toBe(true)
    // 30 点那版：末尾的 7 倍序号（后面隔着两天）让位给最后一天。
    const thirtyLabels = (fearGreedChartOption({
      points: fearGreedSection(30).points,
      palette: CHART_PALETTE_FIXTURE, fonts: CHART_FONTS_FALLBACK
    }).xAxis as { axisLabel: { interval: (index: number) => boolean } }).axisLabel.interval
    expect(thirtyLabels(29)).toBe(true)
    expect(thirtyLabels(28)).toBe(false)
    // 50 那条参考线与「中性」仍在：这是改造前的样子。
    const series = (option.series as Array<{ markLine?: { data: Array<{ yAxis: number }> } }>)[0]!
    expect(series.markLine?.data).toEqual([{ yAxis: 50 }])
    expect(option.yAxis as { min: number; max: number; interval: number }).toMatchObject({ min: 0, max: 100, interval: 50 })
  })

  it('draws a smooth line with a light area once there are three points', () => {
    const many = skewChartOption({ points: skewPoints(29), palette: CHART_PALETTE_FIXTURE, fonts: CHART_FONTS_FALLBACK })
    const manySeries = (many.series as Array<{ data: Array<number | null>; smooth: number; lineStyle: { width: number; opacity: number; color: string }; areaStyle?: unknown }>)[0]!
    // 窗口按数据跨度铺满：29 个连续读数就是 29 天，值一个不多一个不少，不补空日也不加 0。
    expect(manySeries.data).toHaveLength(29)
    expect(manySeries.data.filter(value => value !== null)).toHaveLength(29)
    expect(manySeries.smooth).toBe(0.22)
    expect(manySeries.lineStyle.width).toBe(1.6)
    expect(manySeries.lineStyle.opacity).toBe(1)
    expect(manySeries.lineStyle.color).toBe(CHART_PALETTE_FIXTURE.line)
    expect(manySeries.areaStyle).toBeDefined()
    // 2 个真实读数之间那段就是事实：连线，但不铺面积（2 点的面积是块三角，右端还多一条竖边）。
    const two = skewChartOption({ points: skewPoints(2), palette: CHART_PALETTE_FIXTURE, fonts: CHART_FONTS_FALLBACK })
    const twoSeries = (two.series as Array<{ lineStyle: { width: number; opacity: number }; areaStyle?: unknown }>)[0]!
    expect(twoSeries.lineStyle.width).toBe(1.6)
    expect(twoSeries.lineStyle.opacity).toBe(1)
    expect(twoSeries.areaStyle).toBeUndefined()
    // 1 个点只画点：没有线、没有面积。
    const one = skewChartOption({ points: skewPoints(1), palette: CHART_PALETTE_FIXTURE, fonts: CHART_FONTS_FALLBACK })
    const oneSeries = (one.series as Array<{ lineStyle: { width: number; opacity: number }; areaStyle?: unknown }>)[0]!
    expect(oneSeries.lineStyle.opacity).toBe(0)
    expect(oneSeries.areaStyle).toBeUndefined()
    // 3 个点起才铺面积。
    const three = skewChartOption({ points: skewPoints(3), palette: CHART_PALETTE_FIXTURE, fonts: CHART_FONTS_FALLBACK })
    const threeSeries = (three.series as Array<{ lineStyle: { opacity: number }; areaStyle?: unknown }>)[0]!
    expect(threeSeries.lineStyle.opacity).toBe(1)
    expect(threeSeries.areaStyle).toBeDefined()
    // 面积只对偏斜调淡（0.22 → 0.12）：窄量程里面积太厚，会把曲线压住。构造器是两半共用，靠传参区分。
    expect((threeSeries.areaStyle as { opacity: number }).opacity).toBe(0.12)
  })

  it.each([3, 4, 5, 29, 30])('spans exactly the recorded range (%i days) without inventing points', async (count) => {
    const points = skewPoints(count)
    const option = skewChartOption({ points, palette: CHART_PALETTE_FIXTURE, fonts: CHART_FONTS_FALLBACK })
    const axis = (option.xAxis as { data: string[]; splitLine: { show: boolean } })
    const series = (option.series as Array<{ data: Array<number | null> }>)[0]!
    // 窗口跟着数据跨度走（首日…今天），最多 30 天：5 个读数就铺满 5 天，不被钉死的 30 天挤到右边一小条。
    expect(axis.data).toHaveLength(count)
    expect(axis.data[count - 1]).toBe(points[0]!.day)
    expect(axis.data[0]).toBe(points[count - 1]!.day)
    // 竖向网格线一条都没有。
    expect(axis.splitLine.show).toBe(false)
    // 有数的日子才有值，其余是 null（缺口就是缺口）。
    expect(series.data.filter(value => value !== null)).toHaveLength(count)
  })

  it('draws a clean line without per-point dots once there are more than seven readings', () => {
    // 30 个点每个都画圆点，连起来像「虚线」，读者以为是另一种线型（用户 2026-11-22）。
    // 规则两张图同一条：>7 不画点、≤7 逐点画；1–2 个读数必须看得见点。
    const symbol = (option: unknown) => (option as { series: Array<{ showSymbol: boolean }> }).series[0]!.showSymbol
    for (const count of [8, 29, 30]) {
      expect(symbol(fearGreedChartOption({ points: fearGreedSection(count).points, palette: CHART_PALETTE_FIXTURE, fonts: CHART_FONTS_FALLBACK }))).toBe(false)
      expect(symbol(skewChartOption({ points: skewPoints(count), palette: CHART_PALETTE_FIXTURE, fonts: CHART_FONTS_FALLBACK }))).toBe(false)
    }
    for (const count of [1, 2, 5, 7]) {
      expect(symbol(fearGreedChartOption({ points: fearGreedSection(count).points, palette: CHART_PALETTE_FIXTURE, fonts: CHART_FONTS_FALLBACK }))).toBe(true)
      expect(symbol(skewChartOption({ points: skewPoints(Math.max(count, 1)), palette: CHART_PALETTE_FIXTURE, fonts: CHART_FONTS_FALLBACK }))).toBe(true)
    }
  })

  it('keeps one or two readings off the frame, with the date under each one', () => {
    // 1 个读数那张：点在界内居中，唯一的日期标签也在中间——不许出现「点在最右、日期在中间」。
    const single = skewChartOption({
      points: [{ day: '2026-11-22', observedAt: '2026-11-22T00:00:00.000Z', riskReversal: 13.2 }],
      palette: CHART_PALETTE_FIXTURE, fonts: CHART_FONTS_FALLBACK
    })
    const axis = single.xAxis as { data: string[]; boundaryGap: boolean }
    expect(axis.data).toHaveLength(1)
    expect(axis.boundaryGap).toBe(true)
    // 2 个读数同样让每档占满一格：点在 1/4 与 3/4，不压在绘图区左右边上（用户 2026-11-23：
    // 右点正对着右下角，看着像被边框裁掉）。
    const two = skewChartOption({ points: skewPoints(2), palette: CHART_PALETTE_FIXTURE, fonts: CHART_FONTS_FALLBACK })
    expect((two.xAxis as { boundaryGap: boolean }).boundaryGap).toBe(true)
    // 3 个点起按真实跨度铺满：首尾落回两端，这样 30 点的窗口才是「整段」。
    const three = skewChartOption({ points: skewPoints(3), palette: CHART_PALETTE_FIXTURE, fonts: CHART_FONTS_FALLBACK })
    expect((three.xAxis as { boundaryGap: boolean }).boundaryGap).toBe(false)
  })

  it('keeps the gaps inside the span instead of shrinking to the number of readings', () => {
    // 断档那几天要留白：窗口是「首日…今天」，不是「有几个读数就几天」。
    const points = [
      { day: '2026-08-04', observedAt: '2026-08-04T00:00:00.000Z', riskReversal: 1.8 },
      { day: '2026-08-01', observedAt: '2026-08-01T00:00:00.000Z', riskReversal: 1.5 },
      { day: '2026-07-29', observedAt: '2026-07-29T00:00:00.000Z', riskReversal: 1.2 }
    ]
    const option = skewChartOption({ points, palette: CHART_PALETTE_FIXTURE, fonts: CHART_FONTS_FALLBACK })
    const axis = (option.xAxis as { data: string[] }).data
    const series = (option.series as Array<{ data: Array<number | null> }>)[0]!
    expect(axis).toHaveLength(7)
    expect(axis[0]).toBe('2026-07-29')
    expect(axis[6]).toBe('2026-08-04')
    expect(series.data).toEqual([1.2, null, null, 1.5, null, null, 1.8])
  })

  it('never lets the verdict contradict the reading row about the direction', async () => {
    // 读数行给出方向（「走阔 · 近 5 天」）时，结论还得说「偏斜这半没有可用的方向」——两处口径分叉了
    // （用户 2026-11-22 抓到的就是这张图）。判据取两处共同的来源：方向枚举 `direction.kind`。
    const known = await renderBand(skewClient({ kind: 'steeper' }, 5))
    const knownBand = known.querySelector('.mi-defensive-premium')!
    expect(knownBand.querySelector('[data-skew-direction="steeper"]')).not.toBeNull()
    expect(knownBand.querySelector('[data-verdict]')?.textContent).toBe(dashboardText.defensivePremium.verdict.fear.steeper)
    expect(knownBand.querySelector('[data-verdict]')?.textContent)
      .not.toBe(dashboardText.defensivePremium.verdict.fear.skewMissing)

    // 方向未知时反过来也一样：结论说没方向，读数行里不许出现方向词（图上那句「不够 5 天」不算读数）。
    const unknown = await renderBand(skewClient({ kind: 'unknown', reason: 'insufficient' }, 5))
    const unknownBand = unknown.querySelector('.mi-defensive-premium')!
    expect(unknownBand.querySelector('.mi-defensive-premium__col-foot .mi-defensive-premium__headline-tail [data-skew-direction]')).toBeNull()
    expect(unknownBand.querySelector('[data-verdict]')?.textContent)
      .toBe(dashboardText.defensivePremium.verdict.fear.skewUnknown.insufficient)
  })

  it('names the direction with the 5-day window, and leaves one action in the header when not connected', async () => {
    const container = await renderBand(skewClient({ kind: 'steeper' }))
    const band = container.querySelector('.mi-crypto-dashboard__defensive-premium-row')!
    const direction = band.querySelector('[data-skew-direction="steeper"]')!
    expect(direction.textContent).toBe(`${dashboardText.defensivePremium.skew.direction.steeper} · ${dashboardText.defensivePremium.skew.direction.window}`)
    // 方向已知就不再出「不知道方向」那类句子，也不涂警示色。
    expect(band.querySelector('[data-skew-direction="insufficient"]')).toBeNull()
    expect(direction.classList.contains('mi-defensive-premium__direction--unknown')).toBe(false)

    // 说明行整行删掉（用户 2026-11-24）：6 个读数与满窗都只有图下那一行名字，没有第二行。
    for (const count of [6, 30]) {
      const band = (await renderBand(skewClient({ kind: 'steeper' }, count))).querySelector('.mi-defensive-premium')!
      expect(band.querySelectorAll('.mi-defensive-premium__col-foot')).toHaveLength(3)
      expect(band.querySelector('[data-half="skew"]')!.children).toHaveLength(2)
    }

    const notConnected = await renderBand()
    const actions = [...notConnected.querySelectorAll('.mi-defensive-premium__topbar-actions > button')]
    expect(actions.map(button => button.textContent)).toEqual([dashboardText.defensivePremium.action.viewSource])
  })

  it('draws the skew chart at every count, with the name under it as the only row below', async () => {
    // 用户 2026-11-24：图下不再有「已有几个、还差几个」那种计数说明；图下只有一行名字。
    // 用户 2026-11-22：1 个读数也要把点画出来，画成空框会让人以为没采到——所以各点数都画图、都不空框。
    for (const count of [1, 2, 3, 6, 30]) {
      const container = await renderBand(skewClient({ kind: count < 5 ? 'unknown' : 'steeper', ...(count < 5 ? { reason: 'insufficient' as const } : {}) }, count))
      const column = container.querySelector('[data-half="skew"]')!
      expect(column.querySelector('[data-chart="skew"]')).not.toBeNull()
      expect(column.querySelector('figure')).not.toBeNull()
      expect(column.querySelector('.mi-defensive-premium__state-box')).toBeNull()
      // 图下只有名字行那一行（不是「没有某个属性」这种查不出来的事）。
      expect(column.children).toHaveLength(2)
      // 图在前、名字行在后（DOM 顺序也照读者看到的样子：名字读的是它上面那张图）。
      const foot = column.querySelector('.mi-defensive-premium__col-foot')!
      expect(foot.querySelector('h3')?.textContent).toBe(dashboardText.defensivePremium.skew.name)
      expect(column.querySelector('figure')!.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it.each([
    ['connection-unavailable', { state: 'unavailable' as const, failureCode: 'option-skew-collect-unavailable' as const, cause: 'connection-unavailable' as const }, 'connection'],
    ['upstream-http-error', { state: 'unavailable' as const, failureCode: 'option-skew-collect-unavailable' as const, cause: 'upstream-http-error' as const }, 'source'],
    ['query-failed', { state: 'unavailable' as const, failureCode: 'option-skew-query-unavailable' as const }, 'read']
  ] as const)('names why the skew half could not be read (%s)', async (_name, optionSkew, key) => {
    const client = { query: async (input: { asOf: string; timeZone: string }) => ({
      asOf: input.asOf, windowDays: 30 as const, timeZone: input.timeZone,
      fearGreed: { state: 'available' as const, score: 22, bucket: 'fear' as const, observedAt: '2026-08-04T00:00:00.000Z', latestDay: '2026-08-04', daysAgo: 1, stale: false, seriesStart: '2025-08-05', points: fgPoints(30) },
      optionSkew
    }) }
    const container = await renderBand(client)
    const skewHalf = container.querySelector('[data-half="skew"]')!
    expect(skewHalf.textContent).toContain(dashboardText.defensivePremium.skew.unavailable[key])
    // 三句不许抄成一句：这一句不是另外两句。
    for (const other of ['connection', 'source', 'read'] as const) {
      if (other !== key) expect(skewHalf.textContent).not.toContain(dashboardText.defensivePremium.skew.unavailable[other])
    }
  })

  it('marks a stale reading with a pill and the day it stops at', async () => {
    const client = { query: async (input: { asOf: string; timeZone: string }) => ({
      asOf: input.asOf, windowDays: 30 as const, timeZone: input.timeZone,
      fearGreed: { state: 'available' as const, score: 22, bucket: 'fear' as const, observedAt: '2026-08-01T00:00:00.000Z', latestDay: '2026-08-01', daysAgo: 4, stale: true, seriesStart: '2025-08-05', points: fgPoints(30) },
      optionSkew: { state: 'not-connected' as const }
    }) }
    const container = await renderBand(client)
    const stale = container.querySelector('[data-stale="fear-greed"]')!
    expect(stale.textContent).toContain(dashboardText.defensivePremium.stale.pill)
    expect(stale.textContent).toContain('2026-08-01')
    // 旧了只标「偏旧」，不自己变新：截至仍是源日那一天。这颗牌在左格图下那一行（用户 2026-11-24 起的
    // 位置），不在图位里。
    expect(container.querySelector('[data-half="fear-greed"] [data-chart="fear-greed"]')?.textContent ?? '')
      .not.toContain('2026-08-01')
    expect(container.querySelector('.mi-defensive-premium__col-foot[data-half-foot="fear-greed"]')?.textContent).toContain('2026-08-01')
  })

  it('keeps the three columns and both chart frames while loading, so the card does not collapse', async () => {
    const container = await renderBand({ query: () => new Promise(() => undefined) })
    const band = container.querySelector('.mi-crypto-dashboard__defensive-premium-row')!
    // 三列都在；仪表列一个装饰环、偏斜格一颗带文案的加载态，不是整块被一个加载面替掉。
    expect(band.querySelectorAll('.mi-defensive-premium__col')).toHaveLength(3)
    expect(band.querySelector('[data-sentiment-gauge]')).not.toBeNull()
    expect(band.querySelectorAll('[data-loading-state]')).toHaveLength(1)
    expect(band.querySelectorAll('.loading-spinner')).toHaveLength(2)
    // 整卡加载只许一处 role=status，否则读屏会念两遍。
    expect(band.querySelectorAll('[role="status"]')).toHaveLength(1)
    expect(band.querySelector('.mi-defensive-premium__topbar')).not.toBeNull()
    // 两格各一个空图框：与真图同一高度变量、不画线不画值，还没初始化 ECharts。
    const placeholders = band.querySelectorAll('[data-chart-placeholder]')
    expect(placeholders).toHaveLength(2)
    expect(band.querySelector('[data-chart="fear-greed"]')).toBeNull()
    expect(band.querySelector('[data-chart="skew"]')).toBeNull()
    // 高度走同一个变量（`--mi-defensive-premium-chart-height`），不在这里写死。
    for (const placeholder of placeholders) expect(placeholder.classList.contains('mi-defensive-premium__chart')).toBe(true)
    // 空图框上也写着各自的整句轴说明，不靠组件拼名字与单位。
    expect([...placeholders].map(placeholder => placeholder.querySelector('.mi-defensive-premium__chart-axis')?.textContent))
      .toEqual([dashboardText.defensivePremium.fearGreed.axis, dashboardText.defensivePremium.skew.axis])
    // 仪表那一列照旧画弧（还没有读数，所以没有指针与分数）。
    expect(band.querySelector('[data-sentiment-gauge] [data-chart="gauge"]')).not.toBeNull()
    expect(band.querySelector('[data-gauge-reading]')).toBeNull()
  })

  it('overlays each wait on the frame it replaces, so loading adds no row', async () => {
    const container = await renderBand({ query: () => new Promise(() => undefined) })
    const band = container.querySelector('.mi-crypto-dashboard__defensive-premium-row')!
    const gaugeWait = band.querySelector('[data-sentiment-gauge] .loading-spinner')!
    const skewWait = band.querySelector('[data-half="skew"] [data-loading-state]')!
    // 环叠在仪表那一列、加载态叠在偏斜格的空图框里，都不当网格里独立的一行：
    // 当独立行时加载态比正常态整整高一行，换态卡就跳。
    expect(gaugeWait.closest('.mi-defensive-premium__col-wait')).not.toBeNull()
    expect(skewWait.closest('[data-chart-placeholder]')).not.toBeNull()
    // 播报只在偏斜格那一处：仪表那颗只是装饰环。
    expect(gaugeWait.getAttribute('aria-hidden')).toBe('true')
    expect(gaugeWait.closest('[role="status"]')).toBeNull()
    expect(skewWait.getAttribute('role')).toBe('status')
    expect(skewWait.closest('[data-chart-placeholder]')?.getAttribute('aria-hidden')).toBeNull()
  })

  it('offers no refresh on the first frame, and keeps one disabled refresh while re-reading', async () => {
    // 首帧（还没有过任何一次读数）：标题行不出刷新，重试无从谈起（PRD §6）。
    const first = await renderBand({ query: () => new Promise(() => undefined) })
    expect(first.querySelector('.mi-crypto-dashboard__defensive-premium-row .mi-defensive-premium__refresh')).toBeNull()

    // 读到过一次之后再按刷新：那颗仍在，但禁用——读者看得见入口，也不用担心重复点。
    const base = skewClient({ kind: 'steeper' })
    let calls = 0
    const reread = { query: (input: Parameters<typeof base.query>[0]) => {
      calls += 1
      return calls === 1 ? base.query(input) : new Promise<never>(() => undefined)
    } }
    const container = await renderBand(reread)
    const band = container.querySelector('.mi-crypto-dashboard__defensive-premium-row')!
    const enabled = band.querySelector<HTMLButtonElement>('.mi-defensive-premium__refresh')!
    expect(enabled.disabled).toBe(false)
    await act(async () => enabled.click())
    const redrawing = band.querySelector<HTMLButtonElement>('.mi-defensive-premium__refresh')
    expect(redrawing).not.toBeNull()
    expect(redrawing!.disabled).toBe(true)
  })

  it('turns a first-read failure into one whole-card error, with no half and one retry', async () => {
    const failing = { query: async () => { throw new Error('request failed') } }
    const container = await renderBand(failing)
    const band = container.querySelector('.mi-crypto-dashboard__defensive-premium-row')!
    expect(band.querySelector('.mi-defensive-premium__cell')).toBeNull()
    expect(band.querySelector('[data-verdict]')).toBeNull()
    const stateView = band.querySelector('.state-view')!
    expect(stateView).not.toBeNull()
    // 标题行只剩卡头那颗 ⓘ：重试在状态面里，只有一颗。
    const headerButtons = [...band.querySelectorAll('.mi-defensive-premium__topbar button')]
    expect(headerButtons.map(button => button.getAttribute('aria-label')))
      .toEqual([dashboardText.defensivePremium.titleInfoLabel])
    expect(stateView.querySelectorAll('button')).toHaveLength(1)
  })

  it('falls back to one whole-card state when both halves are unreadable, with no verdict', async () => {
    const bothDown = { query: async (input: { asOf: string; timeZone: string }) => ({
      asOf: input.asOf, windowDays: 30 as const, timeZone: input.timeZone,
      fearGreed: { state: 'unavailable' as const, failureCode: 'fear-greed-query-unavailable' as const },
      optionSkew: { state: 'unavailable' as const, failureCode: 'option-skew-query-unavailable' as const }
    }) }
    const container = await renderBand(bothDown)
    const band = container.querySelector('.mi-crypto-dashboard__defensive-premium-row')!
    expect(band.querySelector('.mi-defensive-premium__cell')).toBeNull()
    expect(band.querySelector('[data-verdict]')).toBeNull()
    expect(band.querySelector('.state-view')).not.toBeNull()
    // 状态面自己带重试，标题行不再给第二颗（AC-14）。
    expect([...band.querySelectorAll('.mi-defensive-premium__topbar button')]).toHaveLength(1)
    expect(band.querySelector('.state-view')!.querySelectorAll('button')).toHaveLength(1)
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
      client: dashboardClient(), sentimentOptionsClient: sentimentOptionsClient(), fundingRateClient: fundingRateClient(),
      openInterestClient: openInterestClient(),
      capitalConditionsClient: { querySnapshot: query }, now: () => new Date(asOf),
      dashboardFeedStatusClient: { query: async () => ({ state: 'available' as const, sources: [
        { sourceId: 'defillama-stablecoins' as const, enabled: true, hasCredential: true },
        { sourceId: 'cryptoetf-etf-flows' as const, enabled: true, hasCredential: true },
        { sourceId: 'alternative-fear-greed' as const, enabled: true, hasCredential: true }
      ] }) },
      onConfigureSources: () => undefined, onManageSource,
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
    // 这卡把 ETF 分成两块（表 + 资金流），两块都各说一次同一句 —— 面板自己的形状，不是本笔改的；
    // 这里钉「说的都是同一句、都是未启用、点名的是这一格」，不重复钉块数。
    expect(stateWords.map(word => word.getAttribute('data-state'))).toEqual(stateWords.map(() => 'disabled'))
    expect(new Set(stateWords.map(word => word.textContent)).size).toBe(1)
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
      client: dashboardClient(), sentimentOptionsClient: sentimentOptionsClient(), fundingRateClient: fundingRateClient(),
      openInterestClient: openInterestClient(),
      capitalConditionsClient: { querySnapshot: query }, now: () => new Date(asOf),
      dashboardFeedStatusClient: { query: async () => ({ state: 'available' as const, sources: [
        { sourceId: 'defillama-stablecoins' as const, enabled: true, hasCredential: true },
        { sourceId: 'cryptoetf-etf-flows' as const, enabled: true, hasCredential: true },
        { sourceId: 'alternative-fear-greed' as const, enabled: true, hasCredential: true }
      ] }) },
      onConfigureSources: () => undefined, onManageSource,
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

/**
 * 用户 2026-11-15：旧日历页整页删掉之后，「右栏那张发布日历右上角的图标」仍然要能进日历
 * ——现在进的是日历抽屉。这条走完整条链路：页面层改序号 → 看板收到请求 → 抽屉打开 → 月历有数据。
 * 旧页面对应的那条断言（跳 `activeView === 'calendar'`）已删，不是静默丢，是被这条接管。
 */
describe('the calendar entry opens the drawer, not a page', () => {
  it('opens the drawer and shows the release calendar once the page asks for it', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const drawerRoot = createRoot(container)
    await act(async () => drawerRoot.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), sentimentOptionsClient: sentimentOptionsClient({
        state: 'available', asOf, score: 40, bucket: 'fear', observedAt: '2026-08-04T10:00:00.000Z'
      }), fundingRateClient: fundingRateClient(), openInterestClient: openInterestClient(),
      now: () => new Date(asOf),
      onConfigureSources: () => undefined, onManageSource: () => undefined,
      openIndicatorDrawerRequest: { seq: 0 },
      calendarEventTitles: { cpi: 'CPI' },
      readCalendarMonth: async () => ({ events: [{
        eventKey: 'evt-cpi', title: 'CPI', countryCode: 'US', countryName: '美国', measureKeys: ['US.CPI.NSA.YOY'],
        eventType: 'economic-indicator', importance: 'high', scheduledAt: '2026-08-10T12:30:00.000Z',
        source: 'Narwhal', sourceObservedAt: '2026-08-04T09:00:00.000Z', coverage: 'observed-unverified'
      }] as never, sources: [] }),
      text: productText['zh-CN'].pages.intelligence.portal.dashboard
    })))
    await flush()
    expect(document.body.querySelector('.mk-minical')).toBeNull()

    // 页面层点那颗图标 = 递一个新的请求（序号加一；`openCalendar` 就是这么接的）。
    await act(async () => drawerRoot.render(createElement(CryptoIntelligenceDashboard, {
      client: dashboardClient(), sentimentOptionsClient: sentimentOptionsClient({
        state: 'available', asOf, score: 40, bucket: 'fear', observedAt: '2026-08-04T10:00:00.000Z'
      }), fundingRateClient: fundingRateClient(), openInterestClient: openInterestClient(),
      now: () => new Date(asOf),
      onConfigureSources: () => undefined, onManageSource: () => undefined,
      openIndicatorDrawerRequest: { seq: 1 },
      calendarEventTitles: { cpi: 'CPI' },
      readCalendarMonth: async () => ({ events: [{
        eventKey: 'evt-cpi', title: 'CPI', countryCode: 'US', countryName: '美国', measureKeys: ['US.CPI.NSA.YOY'],
        eventType: 'economic-indicator', importance: 'high', scheduledAt: '2026-08-10T12:30:00.000Z',
        source: 'Narwhal', sourceObservedAt: '2026-08-04T09:00:00.000Z', coverage: 'observed-unverified'
      }] as never, sources: [] }),
      text: productText['zh-CN'].pages.intelligence.portal.dashboard
    })))
    await flush()
    // 抽屉以 portal 挂到 body（modal 档），不在看板容器里。
    const mini = document.body.querySelector('.mk-minical')
    expect(mini).not.toBeNull()
    // 月历确实有数据：那颗 10 号的格子里出现这条发布。
    expect(mini?.textContent).toContain('CPI')
    await act(async () => drawerRoot.unmount())
    container.remove()
  })
})

/**
 * 用户 2026-11-15：这一块要从看板搬进抽屉右列顶部。
 * 这条断的是**dashboard 有没有把它转手**——只断抽屉本身会漏掉「收到了却没传」这一跳
 * （2026-11-15 就漏过一次：layout 注入 → dashboard 收到 → 抽屉里永远是 undefined）。
 */
it('hands the injected calendar block down to the drawer, not just to its own props', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(createElement(CryptoIntelligenceDashboard, {
    client: dashboardClient(), sentimentOptionsClient: sentimentOptionsClient({
      state: 'available', asOf, score: 40, bucket: 'fear', observedAt: '2026-08-04T10:00:00.000Z'
    }), fundingRateClient: fundingRateClient(), openInterestClient: openInterestClient(),
    now: () => new Date(asOf),
    onConfigureSources: () => undefined, onManageSource: () => undefined,
    openIndicatorDrawerRequest: { seq: 1 },
    calendarBlock: createElement('div', { 'data-test-calendar-block': '' }, '接下来要看的'),
    calendarEventTitles: { cpi: 'CPI' },
    readCalendarMonth: async () => ({ events: [] as never, sources: [] }),
    text: productText['zh-CN'].pages.intelligence.portal.dashboard
  })))
  await flush()
  expect(document.body.querySelector('[data-drawer-calendar-block] [data-test-calendar-block]')).not.toBeNull()
  await act(async () => root.unmount())
  container.remove()
})
