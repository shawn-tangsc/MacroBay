import type { ReactElement } from 'react'

export type FlowLegendText = { fundsColumn: string; btc: string; eth: string }

/**
 * The three series names, once.
 *
 * The card and the dialog both show the chart, and a chart whose colours are named somewhere
 * else is a chart the reader has to guess at — so both render this same node in the same order
 * rather than each keeping its own copy of the labels.
 */
export function CapitalFlowLegend({ text }: Readonly<{ text: FlowLegendText }>): ReactElement {
  return <div className="mi-capital-conditions__chart-legend">
    <span><i data-series="funds" />{text.fundsColumn}</span>
    <span><i data-series="btc" />{text.btc}</span>
    <span><i data-series="eth" />{text.eth}</span>
  </div>
}
