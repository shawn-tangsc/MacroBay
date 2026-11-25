import { cryptoEtfSourcePolicy } from './cryptoEtfSourcePolicy'
import type { AgentDefinition, PanelDefinition } from './providerRegistryTypes'
import { zeroXRouterCalendarSourceIds } from './zeroXRouterProvider'

/**
 * **面板与激活分组**：哪些 agent 在跑、它按什么分层暖哪些源。
 *
 * 与来源定义表分开，是因为读者是两拨人：改源的人看 `providerDefinitions.ts`（这个源采什么、
 * 给谁看），改激活策略的人看这里（这个 agent 第一优先要哪几个源）。合成一张表时，
 * 改一档 tier 要在两百多行源定义里找，改一个源又要翻过整张分组表。
 */

export const panelRegistry: readonly PanelDefinition[] = [
  { panelId: 'dashboard', agentId: 'crypto', displayName: 'Crypto dashboard' },
  { panelId: 'economic-calendar', agentId: 'crypto', displayName: 'Economic calendar' }
]

export const agentRegistry: readonly AgentDefinition[] = [
  {
    agentId: 'crypto',
    displayName: 'Crypto Market Analyst',
    activation: 'available',
    groups: [
      { groupId: 'fear-greed', agentId: 'crypto', tier: 'required', sourceIds: ['alternative-fear-greed'] },
      /* 看板合并卡的右半（BTC 期权偏斜）。分组只为满足「面板源必须在 agent 里」这条判据，
         给最弱一档 `optional`；分析快照不读它（`marketAnalysisContextQuery` 0 处引用）。 */
      { groupId: 'options-skew', agentId: 'crypto', tier: 'optional', sourceIds: ['deribit-options'] },
      { groupId: 'spot-momentum', agentId: 'crypto', tier: 'required', sourceIds: ['binance-spot-market', 'coingecko-market', cryptoEtfSourcePolicy.sourceId, '0xrouter-aggregate-provider', 'realmarketapi-market', 'twelve-data-market'] },
      { groupId: 'funding-rate', agentId: 'crypto', tier: 'required', sourceIds: ['binance-futures-positioning'] },
      {
        groupId: 'macro-calendar',
        agentId: 'crypto',
        tier: 'recommended',
        sourceIds: [
          'macro-calendar-fed',
          'macro-calendar-bea',
          'macro-calendar-bls',
          'macro-calendar-narwhal-economic-data',
          'macro-calendar-narwhal-financial-events',
          'macro-calendar-narwhal-central-bank-activities',
          ...zeroXRouterCalendarSourceIds,
          'macro-calendar-coinmarketcal',
          'federal-reserve-rss',
          'fred-rates-liquidity',
          'treasury-fiscal-data',
          'policy-path-market'
        ]
      },
      { groupId: 'stablecoin-defi', agentId: 'crypto', tier: 'recommended', sourceIds: ['defillama-stablecoins', 'defillama-tvl'] },
      {
        groupId: 'regulation-exchange',
        agentId: 'crypto',
        tier: 'recommended',
        sourceIds: [
          'sec-rss',
          'cftc-rss',
          'binance-announcements',
          'binance-api-updates',
          'okx-latest-announcements',
          'okx-api-announcements',
          'coinbase-status',
          'kraken-status',
          'kraken-system-status',
          'solana-status'
        ]
      },
      { groupId: 'industry-news', agentId: 'crypto', tier: 'optional', sourceIds: ['coindesk-rss', 'ethereum-foundation-blog', 'cryptopanic', 'github-releases'] }
    ]
  },
  { agentId: 'stocks', displayName: 'Equities Market Analyst', activation: 'coming-soon', groups: [] },
  { agentId: 'futures', displayName: 'Futures Market Analyst', activation: 'coming-soon', groups: [] }
]
