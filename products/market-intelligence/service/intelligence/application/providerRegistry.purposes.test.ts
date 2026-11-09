import { describe, expect, it } from 'vitest'

import { allSources } from './providerRegistry'

/**
 * `purposes` 是唯一声明，`panels` 由它派生——所以**派生结果必须与改前逐源完全一致**。
 *
 * 这份对照是 2026-11-10 在 `purposes` 落地前从 `providerRegistry.ts` 逐源抄下来的：6 个源同时供给
 * 看板与经济日历、12 个只供给看板、21 个今天不上任何面板。它不是「重跑一遍看是否稳定」，而是
 * **一次固定下来的改前事实**：派生一旦让某个源凭空多出 `dashboard`，读者就会在没被要求的情况下
 * 在看板上看到它，那是可见行为变化而不是重构。
 */
describe('the derived panels match what the registry declared before purposes existed', () => {
  it('keeps every source on exactly the same panels, neither added nor removed', () => {
    expect(allSources().map((source) => [source.sourceId, source.panels])).toEqual([
    ['macro-calendar-fed', ['dashboard', 'economic-calendar']],
    ['federal-reserve-rss', []],
    ['macro-calendar-bea', ['dashboard', 'economic-calendar']],
    ['bea-economic-series', []],
    ['macro-calendar-bls', ['dashboard', 'economic-calendar']],
    ['bls-economic-series', []],
    ['policy-path-market', ['dashboard']],
    ['fred-rates-liquidity', ['dashboard']],
    ['fred', []],
    ['treasury-fiscal-data', []],
    ['sec-rss', ['dashboard']],
    ['cftc-rss', []],
    ['binance-announcements', ['dashboard']],
    ['binance-api-updates', []],
    ['binance-spot-market', []],
    ['binance-futures-positioning', ['dashboard']],
    ['binance-asset-page', []],
    ['okx-latest-announcements', ['dashboard']],
    ['okx-api-announcements', []],
    ['coingecko-market', []],
    ['defillama-stablecoins', ['dashboard']],
    ['defillama-tvl', []],
    ['alternative-fear-greed', ['dashboard']],
    ['coindesk-rss', ['dashboard']],
    ['ethereum-foundation-blog', []],
    ['cryptopanic', []],
    ['coinmarketcal', []],
    ['macro-calendar-coinmarketcal', []],
    ['0xrouter-aggregate-provider', ['dashboard']],
    ['macro-calendar-0xrouter-economic-data', ['dashboard', 'economic-calendar']],
    ['macro-calendar-0xrouter-financial-events', ['dashboard', 'economic-calendar']],
    ['macro-calendar-0xrouter-central-bank-activities', ['dashboard', 'economic-calendar']],
    ['realmarketapi-market', ['dashboard']],
    ['twelve-data-market', ['dashboard']],
    ['coinbase-status', []],
    ['kraken-status', []],
    ['kraken-system-status', []],
    ['solana-status', []],
    ['github-releases', []],
    ])
  })

  it('maps only dashboard and calendar to a panel, never briefing or sentiment', () => {
    // 这两条是消费线，没有「面板」这一层；若把它们映射成面板，源会凭空出现在看板上。
    const withOnlyConsumers = allSources().filter((source) =>
      (source.purposes ?? []).length > 0 && (source.purposes ?? []).every((purpose) => purpose === 'briefing' || purpose === 'sentiment'))
    for (const source of withOnlyConsumers) expect(source.panels).toEqual([])
  })
})
