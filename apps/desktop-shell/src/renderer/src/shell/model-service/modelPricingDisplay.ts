import type { ModelDefinition } from '@platform/ai/providers/modelProviderTypes'

import type { PlatformText } from '../../i18n/platformText'

export function formatCompactNumber(value: number): string {
  const trim = (next: number): string => String(Math.round(next * 100) / 100)
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`
  if (value >= 1_000) return `${trim(value / 1_000)}K`
  return trim(value)
}

/**
 * 价格数字：小数位由 `pricing.displayPrecision` 决定（缺省 2）。
 *
 * 只有"单价极低"的厂商会在自己的形状里声明更多位（OpenRouter 的 `0.049/百万`
 * 两位小数会变成 `0`）。**不按 providerId 判断**，也不做全局自适应。
 */
export function formatPriceNumber(value: number, precision = 2): string {
  const factor = 10 ** precision
  return String(Math.round(value * factor) / factor)
}

function currencySymbol(currency: string): string {
  if (currency === 'CNY') return '¥'
  if (currency === 'USD') return '$'
  return `${currency} `
}

/**
 * PLAT-77：上下文与价格**各自独立**显示，不再要求两者同时存在。
 * 有上下文没价格（七牛、百炼、硅基）也应当看到上下文。
 */
export function formatModelCost(model: ModelDefinition): string | null {
  const context = model.contextLength === undefined ? null : formatCompactNumber(model.contextLength)
  const pricing = model.pricing === undefined
    ? null
    : `${currencySymbol(model.pricing.currency)}${formatPriceNumber(model.pricing.promptPerMillion, model.pricing.displayPrecision)}/${currencySymbol(model.pricing.currency)}${formatPriceNumber(model.pricing.completionPerMillion, model.pricing.displayPrecision)}`

  if (context === null && pricing === null) return null
  if (context === null) return pricing
  if (pricing === null) return context
  return `${context} · ${pricing}`
}

/**
 * 完整 tooltip 仍要求上下文与价格齐全（单状态行不显示 tooltip）：
 * `modelCostTitle` 的入参是三个非空字符串，放宽就需要改两份 locale，收益不匹配。
 */
export function buildModelCostTitle(labels: PlatformText['models'], model: ModelDefinition): string | null {
  if (model.contextLength === undefined || !model.pricing) return null
  const symbol = currencySymbol(model.pricing.currency)
  return labels.modelCostTitle(
    formatCompactNumber(model.contextLength),
    `${symbol}${formatPriceNumber(model.pricing.promptPerMillion, model.pricing.displayPrecision)}`,
    `${symbol}${formatPriceNumber(model.pricing.completionPerMillion, model.pricing.displayPrecision)}`,
    model.pricing.cacheReadPerMillion === undefined
      ? null
      : `${symbol}${formatPriceNumber(model.pricing.cacheReadPerMillion, model.pricing.displayPrecision)}`,
    model.pricing.currency
  )
}
