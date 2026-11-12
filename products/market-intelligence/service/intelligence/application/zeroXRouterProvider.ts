import { provider, src } from './sourceDefinitionBuilders'
import type { ProviderDefinition } from './providerRegistry'

/**
 * The 0xRouter provider after the ETF switch.
 *
 * Its ETF source no longer collects, and its three calendar feeds now belong to Narwhal, so the
 * provider keeps **one hidden registration** whose only job is provenance: the rows 0xRouter already
 * wrote keep a source they can be attributed to. Nothing here collects, and nothing here is a
 * settings-page entry (`visibility: 'hidden'`), because a key box that feeds no reading is a dead end.
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
      /* **不可见**：0xRouter 已经退到日程链和 ETF 之外，这里只留一条登记，供库里它写过的历史行有归属。
         留着可见就等于在设置页放一个「有密钥框、什么都不采」的入口——那正是这轮反复禁的那种。 */
      src({ sourceId: '0xrouter-aggregate-provider', summaryKey: 'settings.intelligenceSources.sourceSummary.0xrouter-aggregate-provider', displayName: '0xRouter aggregate market', purposes: [], maintenanceOnly: true, visibility: 'hidden', collection: 'none', capabilities: { runNow: 'none', testConnection: false }, adapterRef: '0xrouter-aggregate-provider', requiresProxy: true }),
    ]
  })
