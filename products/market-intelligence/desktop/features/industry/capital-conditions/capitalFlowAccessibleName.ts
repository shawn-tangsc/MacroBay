import { fillLabelParams } from '@platform/ui/components/textKeyParams'

import { formatFlowAccessibleNumber } from './capitalFlowFormat'
import type { FlowLabelDirection } from './capitalFlowLabels'

/** The three text templates an accessible flow name is built from. */
export type FlowAccessibleText = {
  a11yAmount: string
  a11yLabel: string
  a11yCell: string
  flowDirections: Readonly<Record<FlowLabelDirection, string>>
}

/**
 * What a screen reader hears for one number: `4.026 亿美元` / `402.6 million US dollars`.
 *
 * The conversion lives behind this function so a visible string can never pick it up — the
 * chart shows `+$402.6M` and only the accessible name speaks in 亿.
 */
export function flowAccessibleAmount(
  text: FlowAccessibleText,
  value: number,
  locale: 'zh-CN' | 'en-US'
): string {
  return fillLabelParams(text.a11yAmount, { value: formatFlowAccessibleNumber(value, locale) })
}

/** Direction + amount + scope: `净流入 4.026 亿美元，全部美元稳定币`. */
export function flowAccessibleName(
  text: FlowAccessibleText,
  value: number,
  direction: FlowLabelDirection,
  scope: string,
  locale: 'zh-CN' | 'en-US'
): string {
  const spoken = fillLabelParams(text.a11yLabel, {
    direction: text.flowDirections[direction],
    amount: flowAccessibleAmount(text, value, locale)
  })
  return fillLabelParams(text.a11yCell, { amount: spoken, scope })
}
