import { provider, src } from './sourceDefinitionBuilders'
import type { ProviderDefinition } from './providerRegistry'

/**
 * The 0xRouter provider after the ETF switch.
 *
 * Its ETF source no longer collects: the data authorisation is withdrawn (`purposes: []`,
 * `maintenanceOnly`, `collection: 'none'`), and it stays registered only as the credential anchor
 * for the three calendar feeds — the key entry point the reader already configured. `credentialSourceId`
 * is therefore explicit: with no adapter source left, the old derivation would find nothing.
 */
export const zeroXRouterProvider: ProviderDefinition = provider({
    providerId: '0xrouter',
    displayName: '0xRouter',
    category: 'aggregate',
    credential: 'api-key',
    /* Explicit: the ETF source below no longer collects, so the old "first adapter source" guess
       would find nothing and the three calendar feeds would lose their key entry point. */
    credentialSourceId: '0xrouter-aggregate-provider',
    sources: [
      /* ETF data authorisation withdrawn on switch: it feeds no panel and no briefing row any more.
         It stays registered as the credential anchor for the three calendar feeds, and the reader
         still sees its key. Its collection task goes away with `collection: 'none'` — belt and
         braces on top of the failure route that no longer names it. */
      src({ sourceId: '0xrouter-aggregate-provider', summaryKey: 'settings.intelligenceSources.sourceSummary.0xrouter-aggregate-provider', displayName: '0xRouter aggregate market', purposes: [], maintenanceOnly: true, collection: 'none', capabilities: { runNow: 'none', testConnection: true }, adapterRef: '0xrouter-aggregate-provider', requiresProxy: true }),
      src({ sourceId: 'macro-calendar-0xrouter-economic-data', summaryKey: 'settings.intelligenceSources.sourceSummary.macro-calendar-0xrouter-economic-data', displayName: '0xRouter economic data', purposes: ['dashboard', 'calendar', 'briefing'], collection: 'job', kind: 'market-calendar', capabilities: { runNow: 'job', testConnection: true }, requiresProxy: true }),
      src({ sourceId: 'macro-calendar-0xrouter-financial-events', summaryKey: 'settings.intelligenceSources.sourceSummary.macro-calendar-0xrouter-financial-events', displayName: '0xRouter financial events', purposes: ['dashboard', 'calendar', 'briefing'], collection: 'job', kind: 'market-calendar', capabilities: { runNow: 'job', testConnection: true }, requiresProxy: true }),
      src({ sourceId: 'macro-calendar-0xrouter-central-bank-activities', summaryKey: 'settings.intelligenceSources.sourceSummary.macro-calendar-0xrouter-central-bank-activities', displayName: '0xRouter central bank activities', purposes: ['dashboard', 'calendar', 'briefing'], collection: 'job', kind: 'market-calendar', capabilities: { runNow: 'job', testConnection: true }, requiresProxy: true })
    ]
  })
