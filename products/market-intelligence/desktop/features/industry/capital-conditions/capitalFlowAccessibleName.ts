import { fillLabelParams } from '@platform/ui/components/textKeyParams'

import type { FlowLabelDirection } from './capitalFlowLabels'

/**
 * The text templates an accessible flow name is built from.
 *
 * A language brings its own units — Chinese speaks 亿 above one hundred million and 万 below
 * it, English speaks millions — so the amount templates are a union rather than one set every
 * language has to carry. Which one applies is decided by the copy table, not by a locale
 * argument that could disagree with it.
 */
export type FlowAccessibleText = {
  a11yNoFlow: string
  a11yLabel: string
  a11yCell: string
  flowDirections: Readonly<Record<FlowLabelDirection, string>>
} & ({ a11yAmountYi: string; a11yAmountWan: string } | { a11yAmountMillion: string })

function number(value: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits, useGrouping: false }).format(value)
}

/**
 * What a screen reader hears for one number, in a unit people actually speak.
 *
 * `+$82.4M` read as "0.824 亿" tells the listener nothing — nobody says that. Chinese picks the
 * unit by size (亿 from 100M up, 万 below it), English stays in millions, and a zero row says
 * there is no net inflow instead of reading out a number. The conversion lives here, so a
 * visible string can never pick it up: the chart keeps showing `+$402.6M`.
 */
export function flowAccessibleAmount(text: FlowAccessibleText, value: number): string {
  const normalized = Object.is(value, -0) ? 0 : value
  if (normalized === 0) return text.a11yNoFlow
  const absolute = Math.abs(normalized)
  if ('a11yAmountYi' in text) {
    return absolute >= 100_000_000
      ? fillLabelParams(text.a11yAmountYi, { value: number(absolute / 100_000_000, 3) })
      : fillLabelParams(text.a11yAmountWan, { value: number(absolute / 10_000, 0) })
  }
  return fillLabelParams(text.a11yAmountMillion, { value: number(absolute / 1_000_000, 1) })
}

/** Direction + amount + scope: `净流入 4.026 亿美元，全部美元稳定币`. */
export function flowAccessibleName(
  text: FlowAccessibleText,
  value: number,
  direction: FlowLabelDirection,
  scope: string
): string {
  // A flat row has no direction worth saying: "持平 没有净流入" repeats itself.
  const spoken = Object.is(value, 0) || value === 0
    ? text.a11yNoFlow
    : fillLabelParams(text.a11yLabel, {
        direction: text.flowDirections[direction],
        amount: flowAccessibleAmount(text, value)
      })
  return fillLabelParams(text.a11yCell, { amount: spoken, scope })
}
