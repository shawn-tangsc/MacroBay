import { Button } from 'antd'
import { CircleSlash, TriangleAlert } from 'lucide-react'

import { etfFlowPolicy } from '../../../../contracts/etfFlows'
import { useProductTextKey } from '../../../shared/i18n/productTextKey'
import { DASH_CELLS, DashEtfRow, SkeletonEtfRow, type UnavailableNotice } from './capitalUnavailable'
import type { DashboardCapitalConditionsState, DashboardEtfFlowAsset, DashboardEtfMissingReason, DashboardEtfReading } from './capitalConditionsModel'
import { capitalCellBlockSentence, capitalCellBlockText, type DashboardCapitalCellBlock } from './capitalCellBlock'

/**
 * 资金面卡的两张表（稳定币 / ETF），以及它们在三种缺失下的画法。
 *
 * 抽出来是因为 `CapitalConditionsPanel.tsx` 贴 500 行门禁：卡片本体管判定与布局，表格的画法归这里。
 *
 * 四种「这一格没读数」**四种表示，不许混**（用户 2026-11-11 / 口径 2026-11-12）：
 * - 格被读者关掉（确实没有）→ **每一格横杠 `—`**，一个旧读数都不留；
 * - 源停用 / 没配凭据 / 源状态读不到 → **留空** + 一句行内词（句子见 `capitalCellBlock.ts`）；
 * - 源配好、这次没读到 → **留空** + 行内「暂时读不到」，**不给按钮**（ETF 没有真重采入口）；
 * - 空（源答了、答案就是零）→ 不在表里冒充，走卡片的空态。
 */

export type CapitalTableText = Readonly<{
  asset: string
  change1d: string
  change7d: string
  change30d: string
  totalSupply: string
  stablecoin: string
  stablecoinScope: string
  btc: string
  eth: string
  latest: string
  windowDays: string
  coverage: string
  streakColumn: string
  streak: string
  streakSingle: string
  shortFlowDirections: Record<'inflow' | 'outflow' | 'zero', string>
  etfUnknown: string
  etfMissingSourceUnreadable: string
  etfMissingAssetMissing: string
  etfMissingValueMissing: string
  etfComparisonUnaligned: string
  etfComparisonLagging: string
}>

export type AvailableState = Extract<DashboardCapitalConditionsState, { state: 'available' }>

function flowDirection(value: string): 'inflow' | 'outflow' | 'zero' {
  return value.startsWith('+') ? 'inflow' : value.startsWith('-') ? 'outflow' : 'zero'
}

export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => String(values[key] ?? ''))
}

export function StablecoinTable({ state, text, notice, cellOff }: Readonly<{
  state?: AvailableState
  text: CapitalTableText
  notice?: UnavailableNotice
  /** 这一格没读数：表留着，词写在这一行的数据列里（行内状态词，不整表换块）。 */
  cellOff?: DashboardCapitalCellBlock
}>): React.ReactElement {
  const column = (flow: 'change1dUsd' | 'change7dUsd' | 'change30dUsd', percent: 'change1dPercent' | 'change7dPercent' | 'change30dPercent'): React.ReactElement =>
    state === undefined
      ? <td />
      : <td data-flow-direction={flowDirection(state[flow])}>{state[flow]}</td>
  // state-ternary: reviewed — 只决定要不要给百分号小格子挂方向属性；五列表头两种状态下都在。
  const head = (label: string, flow: 'change1dUsd' | 'change7dUsd' | 'change30dUsd', percent: 'change1dPercent' | 'change7dPercent' | 'change30dPercent'): React.ReactElement =>
    <th scope="col">{label}<span className="mi-capital-conditions__pct" {...(state === undefined ? {} : { 'data-flow-direction': flowDirection(state[flow]) })}>{state === undefined ? '' : `(${state[percent]})`}</span></th>
  return <table className="mi-capital-conditions__etf-table mi-capital-conditions__stable-table">
    <colgroup>
      <col className="mi-capital-conditions__etf-col-asset" />
      <col span={3} />
      <col className="mi-capital-conditions__etf-col-supply" />
    </colgroup>
    <thead><tr>
      <th scope="col">{text.asset}</th>
      {head(text.change1d, 'change1dUsd', 'change1dPercent')}
      {head(text.change7d, 'change7dUsd', 'change7dPercent')}
      {head(text.change30d, 'change30dUsd', 'change30dPercent')}
      <th scope="col">{text.totalSupply}</th>
    </tr></thead>
    <tbody>
      {/* 状态行：表头下面的第一行、跨全部数据列。行名与表头一个字不改。 */}
      {notice
        ? <tr className="mi-capital-conditions__status-row" data-status-row="unavailable">
          <td colSpan={5}>
            <div className="mi-capital-conditions__status-inline">
              <span className="mi-source-state" data-state="unreadable">
                <TriangleAlert aria-hidden="true" className="mi-source-state__icon" size={14} />
                <span>{notice.sentence}</span>
              </span>
              <Button onClick={notice.onAction} size="small">{notice.action}</Button>
            </div>
          </td>
        </tr>
        : null}
      <tr data-cell-off={cellOff === undefined ? undefined : 'stablecoin'}>
        <th scope="row">
          <span className="mi-capital-conditions__asset-name">{text.stablecoin}</span>
          <span className="mi-capital-conditions__asset-scope">{text.stablecoinScope}</span>
        </th>
        {cellOff?.kind === 'cell-off'
          // 格被读者关掉 = **确实没有** → 每一格画横杠；旧读数一个都不许留。
          ? DASH_CELLS.map((key) => <td key={key} data-cell-dash="true">—</td>)
          : cellOff
            // 源停 / 没配 / 状态读不到：这一格没有可信读数，留空 + 一句行内词（不画横杠——那是
            // 「确实没有」，而这里只是「这半张表这次没有数」）。
            ? <td colSpan={4}><CellSourceWord block={cellOff} /></td>
            : <>
                {column('change1dUsd', 'change1dPercent')}
                {column('change7dUsd', 'change7dPercent')}
                {column('change30dUsd', 'change30dPercent')}
                <td className="mi-capital-conditions__stable-supply">{state === undefined ? null : state.currentUsd}</td>
              </>}
      </tr>
    </tbody>
  </table>
}


/** One row per asset, one column per horizon: no label repeats inside the body. */
/**
 * ETF 两行：**每一支各说各的**。一支有值就照常显示数字（0 就是 0，不许拿另一支补），
 * 另一支显示「未知」+ 具体原因；两支都读不到才整块换成错误态。
 * 窗口不等长只让**对比列**不可比，不把两份数字一起撤掉（「ETH 晚一天整份作废」就是这么来的）。
 */
/**
 * 一格的「没读数」：**行内一句**，用共享类 `mi-source-state`
 * （规范 `2026-11-11-source-availability-styles.md`；行级/格级就长这样）。
 *
 * 句子按原因取（格关 / 源停 / 没配凭据 / 源状态读不到，见 `capitalCellBlock.ts`）；
 * 不用错误色——它不是故障，是读者要动手的事；「读到了但没读成」不在这一支（由读数自己说）。
 */
export function CellSourceWord({ block }: Readonly<{ block: DashboardCapitalCellBlock }>): React.ReactElement {
  const resolveText = useProductTextKey() as (key: string) => string
  const Icon = block.kind === 'source-unknown' ? TriangleAlert : CircleSlash
  return <span className="mi-source-state" data-state={block.kind === 'source-unknown' ? 'unreadable' : 'disabled'}>
    <Icon aria-hidden="true" className="mi-source-state__icon" size={14} />
    <span>{capitalCellBlockSentence(block, capitalCellBlockText(resolveText))}</span>
  </span>
}

export function EtfTable({ reading, text, onRetry, skeleton = false, cellOff }: {
  reading?: DashboardEtfReading
  text: CapitalTableText
  onRetry?: () => void
  /** 整卡读不到：表头、列名、行名照常，数据格留空（不写「未知」、不铺状态词）。 */
  skeleton?: boolean
  /** 这一格没读数：表留着，词写在表里那一行（与读不到同一摆法）。 */
  cellOff?: DashboardCapitalCellBlock
}): React.ReactElement {
  const unreadable = reading === undefined || reading.state === 'unreadable'
  const coverage = unreadable ? undefined : reading.coverage
  const span = 2 + etfFlowPolicy.cumulativeWindows.length
  // hook 必须在组件顶层无条件调用：`unreadable` 那一支只是用到它的结果，不在分支里调。
  const dataText = useProductTextKey() as (key: string) => string
  return <>
  <table className="mi-capital-conditions__etf-table">
    <colgroup>
      <col className="mi-capital-conditions__etf-col-asset" />
      <col span={3} />
      <col className="mi-capital-conditions__etf-col-streak" />
    </colgroup>
    <thead><tr>
      <th scope="col">{text.asset}</th>
      <th scope="col">{text.latest}</th>
      {etfFlowPolicy.cumulativeWindows.map((days) => {
        const windowCoverage = coverage?.find((candidate) => candidate.windowDays === days)
        return <th scope="col" key={days}>
          {format(text.windowDays, { days })}
          {windowCoverage && !windowCoverage.complete
            ? <> <span className="mi-capital-conditions__coverage">{format(text.coverage, { days: windowCoverage.coveredDays })}</span></>
            : null}
        </th>
      })}
      <th scope="col">{text.streakColumn}</th>
    </tr></thead>
    <tbody>
      {skeleton
        ? <>
            <SkeletonEtfRow label={text.btc} series="btc" span={span} />
            <SkeletonEtfRow label={text.eth} series="eth" span={span} />
          </>
        : cellOff?.kind === 'cell-off'
          // 格被读者关掉：这一格的两行**都画横杠**，旧读数一个都不许留（关掉的源不许继续报数）。
          ? <>
              <DashEtfRow label={text.btc} series="btc" span={span} />
              <DashEtfRow label={text.eth} series="eth" span={span} />
            </>
          : cellOff
            // 源停 / 没配 / 状态读不到：拿不到可信读数，留空 + 一句行内词（不画横杠——那是「确实没有」）。
            ? <tr data-etf-unavailable={cellOff.kind}><td className="mi-capital-conditions__etf-unavailable" colSpan={span}>
                <CellSourceWord block={cellOff} />
              </td></tr>
            : unreadable
            // 读不到 = **拿不到**：留空 + 一句行内状态词（不画横杠——那是「确实没有」）。
            ? <tr data-etf-unavailable="true"><td className="mi-capital-conditions__etf-unavailable" colSpan={span}>
                <span className="mi-source-state" data-state="unreadable">
                  <TriangleAlert aria-hidden="true" className="mi-source-state__icon" size={14} />
                  <span>{dataText('pages.intelligence.portal.data.temporarilyUnavailable')}</span>
                </span>
              </td></tr>
            : <>
              <EtfRow asset={reading.btc} label={text.btc} missing={reading.missing?.btc} text={text} />
              <EtfRow asset={reading.eth} label={text.eth} missing={reading.missing?.eth} text={text} />
            </>}
    </tbody>
  </table>
  {/* 对比列单独说：不可比，且只在有 `laggingDays` 时念出落后几个交易日。 */}
  {!unreadable && reading.comparison.state === 'unaligned'
    ? <p className="mi-capital-conditions__etf-comparison" data-etf-comparison="unaligned">
        {text.etfComparisonUnaligned}
        {/* 只有「最新交易日不同」那一支带得出落后几个交易日；另一支没有这个数就不念。 */}
        {'laggingDays' in reading.comparison
          ? ` · ${format(text.etfComparisonLagging, { days: reading.comparison.laggingDays })}`
          : null}
      </p>
    : null}
  </>
}

function EtfRow({ asset, label, missing, text }: {
  asset?: DashboardEtfFlowAsset
  label: string
  /** 这一支读不到时由模型给的原因；有 `asset` 就不用它。 */
  missing?: DashboardEtfMissingReason
  text: CapitalTableText
}): React.ReactElement {
  // 这一支没值：说「未知」并给原因，**不补 0、不拿另一支顶**。
  if (asset === undefined) {
    return <tr data-etf-missing={missing ?? 'asset-missing'}>
      <th scope="row"><i className="mi-capital-conditions__asset-dot" data-series={label === text.eth ? 'eth' : 'btc'} aria-hidden="true" />{label}</th>
      <td className="mi-capital-conditions__etf-unknown" colSpan={1 + etfFlowPolicy.cumulativeWindows.length + 1}>
        {text.etfUnknown} · {missingReasonText(missing, text)}
      </td>
    </tr>
  }
  const latest = asset.rows.at(-1)
  const days = latest ? consecutiveDirectionDays(asset.rows, latest.direction) : 0
  const streak = latest && days > 0
    ? format(days === 1 ? text.streakSingle : text.streak, { flow: text.shortFlowDirections[latest.direction], count: days })
    : ''
  return <tr>
    <th scope="row"><i className="mi-capital-conditions__asset-dot" data-series={asset.asset.toLowerCase()} aria-hidden="true" />{label}</th>
    <td data-flow-direction={flowDirection(asset.latestNetFlowUsd)}>{asset.latestNetFlowUsd}</td>
    {asset.cumulative.map((window) => <td key={window.windowDays} data-flow-direction={flowDirection(window.netFlowUsd)}>{window.netFlowUsd}</td>)}
    <td className="mi-capital-conditions__streak" data-flow-direction={latest?.direction}>{streak}</td>
  </tr>
}

function missingReasonText(reason: DashboardEtfMissingReason | undefined, text: CapitalTableText): string {
  switch (reason) {
    case 'source-unreadable': return text.etfMissingSourceUnreadable
    case 'value-missing': return text.etfMissingValueMissing
    default: return text.etfMissingAssetMissing
  }
}

function consecutiveDirectionDays(rows: readonly { direction: 'inflow' | 'outflow' | 'zero' }[], direction: 'inflow' | 'outflow' | 'zero'): number {
  let days = 0
  for (let index = rows.length - 1; index >= 0 && rows[index]?.direction === direction; index -= 1) days += 1
  return days
}

/**
 * The chart, the info bubble and the daily table. All of them read the same
 * `flowHistory.rows` handed down by the projection — the seven-day window is cut once, in the
 * model — and the table's trigger sits in the title row while its panel hangs off this section's
 * bottom edge, so opening it moves nothing in the card.
 */
