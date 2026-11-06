/**
 * 从源站标题里认口径：同比 / 环比（情报需求 §十二之一）。
 *
 * **认不出就不写，不许猜**：`CPI (YoY)` / `CPI y/y` / `同比` 都算同比，`MoM` / `环比` 算环比；
 * 其余一律 `undefined`，正文末尾就不带括号。
 *
 * 句子与其余槽位不在这里：成品由 `macroEventSentence.ts` 按 `contracts/macroEventNotificationSentences.ts`
 * 的骨架拼好，指标名走 `contracts/indicatorNames.ts` 那一个入口。
 */

export type SurprisePeriodicity = 'yoy' | 'mom'

export function recognizePeriodicity(title: string): SurprisePeriodicity | undefined {
  const text = title.toLowerCase()
  if (/yoy|y\/y|year[- ]over[- ]year|同比/.test(text)) return 'yoy'
  if (/mom|m\/m|month[- ]over[- ]month|环比/.test(text)) return 'mom'
  return undefined
}
