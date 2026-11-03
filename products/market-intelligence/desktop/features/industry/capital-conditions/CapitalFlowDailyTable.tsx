import { flowAccessibleName, type FlowAccessibleText } from './capitalFlowAccessibleName'
import { formatFlowUsd } from './capitalFlowFormat'
import { shortFlowDate, type FlowChartRow } from './capitalFlowRows'

type DailyTableText = FlowAccessibleText & {
  dailyFundsShort: string
  fundsScope: string
  btc: string
  eth: string
  etfScope: string
  dailyCaption: string
  dailyUnits: string
  dailyPanelTitle: string
  dateColumn: string
}

/**
 * The daily numbers, as a table. It is content, not a control: the trigger lives in the card's
 * title row and the panel that shows this table belongs to `AnchoredPanel`, so nothing here
 * positions, closes or focuses anything.
 *
 * Column heads stay short (日期 / 稳定币 / BTC / ETH) because the panel is narrow; the full
 * scopes are still spoken, through each cell's accessible name. The head carries the panel title
 * and the unit/UTC line, and only the rows scroll — the head stays put.
 */
export function CapitalFlowDailyTable({ rows, text }: Readonly<{
  rows: readonly FlowChartRow[]
  text: DailyTableText
}>): React.ReactElement {
  return <div className="mi-capital-conditions__daily">
    <div className="mi-capital-conditions__daily-head">
      <h4>{text.dailyPanelTitle}</h4>
      <span className="mi-capital-conditions__daily-units">{text.dailyUnits}</span>
    </div>
    {/* The visible head already says what this is; the caption stays for the table's own name. */}
    <div className="mi-capital-conditions__daily-scroll">
      <table className="mi-capital-conditions__daily-table" tabIndex={0}>
        <caption className="mi-capital-conditions__daily-caption">{`${text.dailyCaption} · ${text.dailyUnits}`}</caption>
        <thead>
          <tr>
            <th scope="col">{text.dateColumn}</th>
            <th scope="col">{text.dailyFundsShort}</th>
            <th scope="col">{text.btc}</th>
            <th scope="col">{text.eth}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.tradingDate}>
              <th scope="row" data-trading-date={row.tradingDate}>{shortFlowDate(row.tradingDate)}</th>
              <DailyCell value={row.funds} scope={text.fundsScope} text={text} />
              <DailyCell value={row.btc} scope={text.etfScope} text={text} />
              <DailyCell value={row.eth} scope={text.etfScope} text={text} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
