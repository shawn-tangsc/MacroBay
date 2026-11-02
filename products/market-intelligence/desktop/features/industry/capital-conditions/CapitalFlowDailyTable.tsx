import { useId, useState } from 'react'

import { flowAccessibleName, type FlowAccessibleText } from './capitalFlowAccessibleName'
import { formatFlowUsd } from './capitalFlowFormat'
import { shortFlowDate, type FlowChartRow } from './capitalFlowRows'

type DailyTableText = FlowAccessibleText & {
  fundsColumn: string
  fundsScope: string
  btc: string
  eth: string
  etfScope: string
  expandDaily: string
  collapseDaily: string
  sameSource: string
  dailyCaption: string
  dateColumn: string
  utcDays: string
  dailyEmpty: string
}

/**
 * The daily numbers behind the chart, in a table.
 *
 * Collapsed means absent: nothing is rendered under the button, so the card keeps its height
 * and there is no empty box to scroll past. Opening renders the table and leaves focus on the
 * button — the reader Tabs into the table when they are ready, the table never grabs them.
 * `aria-controls` appears only while it points at something.
 */
export function CapitalFlowDailyTable({ rows, text, notComparable }: Readonly<{
  rows: readonly FlowChartRow[]
  text: DailyTableText
  /** The very same string the chart note renders, so the two are equal by construction. */
  notComparable: string
}>): React.ReactElement {
  const [open, setOpen] = useState(false)
  const tableId = useId()

  if (rows.length === 0) return <p className="mi-capital-conditions__daily-empty">{text.dailyEmpty}</p>

  return <div className="mi-capital-conditions__daily">
    <div className="mi-capital-conditions__daily-toggle">
      {/* 句子里的文字动作：颜色/焦点环走共享类，调用点只留布局用的那个类名。 */}
      <button type="button" className="text-action mi-capital-conditions__daily-button"
        aria-expanded={open} {...(open ? { 'aria-controls': tableId } : {})}
        onClick={() => setOpen((current) => !current)}>
        {open ? text.collapseDaily : text.expandDaily}
      </button>
      <span className="mi-capital-conditions__daily-source">{text.sameSource}</span>
    </div>
    {open ? <div id={tableId}>
      <table className="mi-capital-conditions__daily-table" tabIndex={0}>
        <caption>{text.dailyCaption}</caption>
        <thead><tr>
          <th scope="col">{text.dateColumn}<span className="mi-capital-conditions__daily-scope">{text.utcDays}</span></th>
          <th scope="col">{text.fundsColumn}<span className="mi-capital-conditions__daily-scope">{text.fundsScope}</span></th>
          <th scope="col">{text.btc}<span className="mi-capital-conditions__daily-scope">{text.etfScope}</span></th>
          <th scope="col">{text.eth}<span className="mi-capital-conditions__daily-scope">{text.etfScope}</span></th>
        </tr></thead>
        <tbody>
          {rows.map((row) => <tr key={row.tradingDate}>
            <th scope="row" data-trading-date={row.tradingDate}>{shortFlowDate(row.tradingDate)}</th>
            <DailyCell value={row.funds} scope={text.fundsScope} text={text} />
            <DailyCell value={row.btc} scope={text.etfScope} text={text} />
            <DailyCell value={row.eth} scope={text.etfScope} text={text} />
          </tr>)}
        </tbody>
      </table>
      <p className="mi-capital-conditions__daily-note">{notComparable}</p>
    </div> : null}
  </div>
}

function DailyCell({ value, scope, text }: Readonly<{
  value: number
  scope: string
  text: DailyTableText
}>): React.ReactElement {
  const direction = value > 0 ? 'inflow' : value < 0 ? 'outflow' : 'zero'
  return <td aria-label={flowAccessibleName(text, value, direction, scope)} data-flow-direction={direction}>
    {formatFlowUsd(value)}
  </td>
}
