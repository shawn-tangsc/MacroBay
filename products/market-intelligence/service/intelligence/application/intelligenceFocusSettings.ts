import type { IntelligenceFocusMarket } from '../schema/intelligenceSource'

export const INTELLIGENCE_FOCUS_MARKET_IDS = [
  'global-macro',
  'digital-assets',
  'cn-a-shares',
  'us-equities',
  'china-futures',
  'fx',
  'commodities'
] as const satisfies readonly IntelligenceFocusMarket[]

export type IntelligenceFocusMarketSettings = {
  enabledFocusMarkets: IntelligenceFocusMarket[]
  updatedAt: string
}

export function createDefaultFocusMarketSettings(now = new Date().toISOString()): IntelligenceFocusMarketSettings {
  return {
    enabledFocusMarkets: ['global-macro', 'digital-assets'],
    updatedAt: now
  }
}

export function normalizeFocusMarketSettings(
  input: Partial<IntelligenceFocusMarketSettings> | undefined,
  now = new Date().toISOString()
): IntelligenceFocusMarketSettings {
  const defaults = createDefaultFocusMarketSettings(now)
  const enabled = Array.isArray(input?.enabledFocusMarkets)
    ? [...new Set(input.enabledFocusMarkets.filter(isFocusMarketId))]
    : defaults.enabledFocusMarkets

  return {
    enabledFocusMarkets: enabled.length > 0 ? enabled : defaults.enabledFocusMarkets,
    updatedAt: input?.updatedAt ?? now
  }
}

export function isFocusMarketId(value: string): value is IntelligenceFocusMarket {
  return (INTELLIGENCE_FOCUS_MARKET_IDS as readonly string[]).includes(value)
}
