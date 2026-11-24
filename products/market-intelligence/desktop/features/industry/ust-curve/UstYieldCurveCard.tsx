import { useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { RefreshCw } from 'lucide-react'

import { Segmented } from '@platform/ui/components/segmented'
import { StateView } from '@platform/ui/components/state'
import { LoadingState } from '@platform/ui/components/loading'
import { IconButton } from '@platform/ui/components/icon-button'
import { helpTrigger } from '@platform/ui/components/popover'
import { STATE_VIEW_ACTION_KEYS } from '@platform/ui/components/state/stateViewText'
import { formatShellTimeZoneLabel } from '@platform/ui/time/shellTimeFormat'

import type { MacroRatesSnapshotView } from '../../../../contracts/macro/macroRatesSnapshotContracts'
import { UstCurveChart } from './UstCurveChart'
import {
  buildUstCurve, buildUstRows, ustChangeWindows, ustCurveRanges, ustHasAnyReading, ustHasCurveLines,
  ustObservationDates, ustTablePeriod, ustTenors,
  type UstChangeWindow, type UstCurveBaseline, type UstCurveMode, type UstCurveRange, type UstRow
} from './ustCurveModel'
import './ustYieldCurve.css'

const KEY = 'pages.intelligence.portal.dashboard.ustCurve'

/**
 * 国债收益率 · 日频：左边一张九行数字表（最新 + 1 日/1 周/1 月/1 年，变化一律 bp），右边五条期限的曲线。
 *
 * 一张卡只读**一份**快照：表的四列和图上的四条窗口都是同一批 `window` 的切片，不新开查询。
 * 价差（bp、另一根轴）与实际利率（另一个市场）只留在表里——它们不进曲线。
 *
 * 六态 + 部分态：整块读不到/没启用/空走平台 `StateView`（句子来自平台，不在这里造）；
 * 单条缺只影响那一行，图少画一条。
 */
export type UstYieldCurveCardProps = Readonly<{
  snapshot?: MacroRatesSnapshotView
  state: 'loading' | 'ready' | 'unavailable'
  /** FRED 利率源被读者关掉：整卡说「没启用」，不是「读不到」。 */
  sourceDisabled?: boolean
  resolveText: (key: string) => string
  /** 读者时区（页脚「时区」那一项）；短名交给平台的格式器，卡片不自己拼 `GMT+8`。 */
  timeZone: string
  locale?: string
  /** 契约承认的序列；默认取公开契约那一份。用例用它钉「未接入」与「暂时读不到」的区别。 */
  admittedSeriesIds?: readonly string[]
  /** 重读同一份快照。`error` 与 `disabled` 两个整块状态都要求动作，所以这里是必填而不是可选。 */
  onRefresh: () => void
  /** 去启用 FRED 利率源；同上，`disabled.target-disabled` 要求动作。 */
  onEnableSource: () => void
}>

export function UstYieldCurveCard({
  snapshot, state, sourceDisabled = false, resolveText, timeZone, locale = 'zh-CN', admittedSeriesIds, onRefresh, onEnableSource
}: UstYieldCurveCardProps): ReactElement {
  const [range, setRange] = useState<UstCurveRange>('3m')
  // 默认看「起点归一」（用户 2026-11-24）：进来先看五条线相对窗口起点怎么走，收益率仍可切换。
  // 只是默认值，不持久化——用户要的不是「记住上次选择」。
  const [mode, setMode] = useState<UstCurveMode>('normalized')
  const copy = (key: string): string => resolveText(`${KEY}.${key}`)

  const rows = useMemo(() => buildUstRows({ snapshot, ...(admittedSeriesIds === undefined ? {} : { admittedSeriesIds }) }),
    [snapshot, admittedSeriesIds])
  const curve = useMemo(() => buildUstCurve({ rows, range, mode }), [rows, range, mode])

  const title = <div className="mi-ust__head">
    <div className="mi-ust__heading">
      <h3>{copy('title')}</h3>
      {helpTrigger({ text: copy('info') })}
    </div>
    <IconButton
      ariaLabelKey={`${KEY}.refresh`}
      icon={RefreshCw}
      size="md"
      variant="plain"
      resolveText={resolveText}
      onSelect={onRefresh} />
  </div>

  const section = (body: ReactElement | ReactElement[], whole = false): ReactElement =>
    <section className="mi-ust" data-region="ust" aria-label={copy('title')}>
      {title}
      <div className="mi-ust__body" {...(whole ? { 'data-whole': 'true' } : {})}>{body}</div>
    </section>

  if (sourceDisabled) {
    return section(<StateView
      state="disabled"
      reasonCode="target-disabled"
      resolveText={resolveText}
      action={{ labelKey: STATE_VIEW_ACTION_KEYS.enable, onSelect: onEnableSource }} />, true)
  }
  if (state === 'loading') return section(<LoadingState label={copy('loading')} minHeight={240} />, true)
  if (state === 'unavailable') {
    return section(<StateView
      state="error"
      reasonCode="unreadable"
      resolveText={resolveText}
      action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: onRefresh }} />, true)
  }
  if (!ustHasAnyReading(rows)) {
    // 七条序列一条都没有：整卡空态，不画一张九行都写「未接入」的表（那只是噪音）。
    return section(<StateView state="empty" reasonCode="not-yet" resolveText={resolveText} />, true)
  }

  return section([
    <div className="mi-ust__table-col" key="table">
      <UstTable rows={rows} copy={copy} />
    </div>,
    <div className="mi-ust__chart-col" key="chart">
      <div className="mi-ust__chart-tools">
        <span className="mi-ust__control">
          <span className="mi-ust__control-label">{copy('axisLabel')}</span>
          <Segmented
            items={[{ value: 'level', labelKey: `${KEY}.mode.level` }, { value: 'normalized', labelKey: `${KEY}.mode.normalized` }]}
            value={mode}
            onChange={(value) => setMode(value === 'normalized' ? 'normalized' : 'level')}
            ariaLabelKey={`${KEY}.modeAria`}
            resolveText={resolveText} />
        </span>
        <span className="mi-ust__control">
          <span className="mi-ust__control-label">{copy('curveLabel')}</span>
          <Segmented
            items={ustCurveRanges.map((entry) => ({ value: entry.id, labelKey: `${KEY}.periods.${entry.id}` }))}
            value={range}
            onChange={(value) => {
              const next = ustCurveRanges.find((entry) => entry.id === value)
              if (next) setRange(next.id)
            }}
            ariaLabelKey={`${KEY}.periodAria`}
            resolveText={resolveText} />
        </span>
      </div>
      {!ustHasCurveLines(curve)
        // 五个期限全缺、但表里还有数（实际利率/通胀补偿）：只替换图这一块，表照留。
        ? <StateView state="empty" reasonCode="not-yet" resolveText={resolveText} />
        : <UstCurveChart
          view={curve}
          mode={mode}
          ariaLabel={copy(mode === 'level' ? 'ariaLevel' : 'ariaNormalized')}
          format={{
            level: (value) => percent(copy, value, 2),
            bp: (value) => basisPoints(copy, value),
            monthDay: (period) => period.slice(5),
            fullDay: (period) => period,
            tenor: (id) => copy(`rows.${id}`)
          }} />}
    </div>,
    <UstFooter key="foot" rows={rows} mode={mode} curve={curve} copy={copy} zone={formatShellTimeZoneLabel(timeZone, locale)} />
  ])
}

function UstTable({ rows, copy }: Readonly<{ rows: readonly UstRow[]; copy: (key: string) => string }>): ReactElement {
  // 基准是「大多数行共有的一天」，不是最新的一天：通胀那几条序列天然晚一天（见 `ustTablePeriod`）。
  const tablePeriod = ustTablePeriod(rows)
  return <table className="mi-ust__table" aria-label={copy('tableAria')}>
    <colgroup>
      <col className="mi-ust__col-name" /><col className="mi-ust__col-latest" />
      <col className="mi-ust__col-window" /><col className="mi-ust__col-window" />
      <col className="mi-ust__col-window" /><col className="mi-ust__col-window" />
    </colgroup>
    <thead>
      <tr>
        <th scope="col" rowSpan={2} className="mi-ust__is-left">{copy('colName')}</th>
        <th scope="col" rowSpan={2}>{copy('colLatest')}</th>
        <th scope="colgroup" colSpan={4}>{copy('colChange')}</th>
      </tr>
      <tr>{ustChangeWindows.map((entry) => <th scope="col" key={entry.id}>{copy(entry.labelKey)}</th>)}</tr>
    </thead>
    <tbody>
      {rows.map((row) => <tr key={row.id} {...(row.block ? { 'data-block': 'true' } : {})}>
        <th scope="row">
          {copy(row.labelKey)}
          {row.availability.state === 'values' && row.availability.lastPeriod !== tablePeriod
            ? <span className="mi-ust__row-as-of">{copy('templates.asOf').replace('{date}', row.availability.lastPeriod.slice(5))}</span>
            : null}
        </th>
        {row.availability.state === 'values'
          ? <>
            <td>{row.availability.latest.kind === 'basis-points'
              ? basisPoints(copy, row.availability.latest.value)
              : percent(copy, row.availability.latest.value, 2)}</td>
            {ustChangeWindows.map((entry) => <ChangeCell
              key={entry.id}
              bp={row.availability.state === 'values' ? row.availability.changes[entry.id as UstChangeWindow] : null}
              copy={copy} />)}
          </>
          : row.availability.state === 'gap'
            ? <GapCells gap={row.availability.gap} copy={copy} />
            : <td className="mi-ust__row-state" colSpan={5}>
              {row.availability.state === 'not-connected' ? copy('notConnected') : copy('unreadableOne')}
            </td>}
      </tr>)}
    </tbody>
  </table>
}

function ChangeCell({ bp, copy }: Readonly<{ bp: number | null; copy: (key: string) => string }>): ReactElement {
  if (bp === null) {
    // 窗口不够：这是「还没有这么久的历史」，不是 0；原因进可访问名，格内只留破折号。
    return <td data-unavailable="true" aria-label={copy('dashShort')} title={copy('dashShort')}>{copy('dash')}</td>
  }
  return <td data-direction={String(Math.sign(bp))}>{signed(copy, bp)}</td>
}

function GapCells({ gap, copy }: Readonly<{ gap: Readonly<{ kind: 'leg-missing'; legKey: string }> | Readonly<{ kind: 'dates-differ' }>; copy: (key: string) => string }>): ReactElement {
  const reason = gap.kind === 'leg-missing'
    ? copy('dashLegMissing').replace('{leg}', copy(gap.legKey))
    : copy('dashLegsDiffer')
  return <>{[0, 1, 2, 3, 4].map((index) => (
    <td key={`gap-${index}`} data-unavailable="true" aria-label={reason} title={reason}>{copy('dash')}</td>
  ))}</>
}

function UstFooter({ rows, mode, curve, copy, zone }: Readonly<{
  rows: readonly UstRow[]
  mode: UstCurveMode
  curve: Readonly<{ baseline?: UstCurveBaseline }>
  copy: (key: string) => string
  zone: string
}>): ReactElement {
  const dates = ustObservationDates(rows)
  const observed = dates.length > 1
    ? copy('templates.footRange').replace('{from}', dates[0] ?? '').replace('{to}', (dates.at(-1) ?? '').slice(5))
    : copy('templates.footObserved').replace('{date}', dates[0] ?? '')
  const parts = [observed, copy('footLag'), copy('footSource'), copy('templates.footZone').replace('{zone}', zone)]
  if (mode === 'normalized' && curve.baseline !== undefined) {
    // 页脚只有一格：共同基准就写那一天；拿不出共同日才说「各线自首个观测日」。
    parts.push(curve.baseline.kind === 'common'
      ? copy('templates.footBase').replace('{date}', curve.baseline.period)
      : copy('templates.footBasePerLine'))
  }
  return <p className="mi-ust__foot">
    {parts.map((part, index) => <span key={`${part}-${index}`}>
      {index === 0 ? null : <i>{copy('templates.separator')}</i>}{part}
    </span>)}
  </p>
}

/** 收益率：两位小数 + `%`，模板在文案表里。 */
function percent(copy: (key: string) => string, value: number, digits: number): string {
  return copy('templates.percent').replace('{value}', value.toFixed(digits))
}

/** 基点：整数，带符号；比例里不带方向词，符号自己说得清。 */
function basisPoints(copy: (key: string) => string, value: number): string {
  return copy('templates.basisPoints').replace('{value}', signed(copy, Math.round(value)))
}

function signed(copy: (key: string) => string, value: number): string {
  if (value === 0) return copy('signs.zero')
  return value > 0 ? `${copy('signs.plus')}${value}` : `${copy('signs.minus')}${Math.abs(value)}`
}

export { ustTenors }
