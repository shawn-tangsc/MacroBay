import { provider, src } from './sourceDefinitionBuilders'
import type { ProviderDefinition } from './providerRegistry'

/**
 * The 0xRouter provider after the ETF switch.
 *
 * Its ETF source no longer runs a schedule, and its three calendar feeds now belong to Narwhal, so
 * what is left is one **visible** registration: nothing collects on a timer, but the daily briefing's
 * ETF history backfill still reads its flow-history on demand, gated by the reader's own switch. A
 * source that is read but cannot be seen is a switch nobody can turn off; this one can be.
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
      /* **可见**：它今天不排定时采集，但**仍按需被读**——日报的 ETF 历史回溯走它的 flow-history，
         门控就是读者自己的 profile 开关。看不见却还在供数，就是一个关不掉的源；看得见、关得掉，
         才是真控制。`runNow: 'none'`（没有手动采集），密钥可测（探针打 /account/balance）。
         等日报回溯真切到 CryptoETF、这条零调用之后，再整条删登记（删源是读者可见变化，产品先点头）。 */
      /* 三路日历源：**读者可配置、默认关**。启用才由 `zeroXRouterCalendarScheduler` 注册作业；
         不进 `AUTOMATIC_CALENDAR_FEED_IDS`（采集归日历线自己的调度器拥有，通用名单加了会去刷错的东西）。 */
      src({ purposes: ['calendar'], sourceId: 'macro-calendar-0xrouter-economic-data', summaryKey: 'settings.intelligenceSources.sourceSummary.macro-calendar-0xrouter-economic-data', displayName: 'Market calendar · economic data', collection: 'job', kind: 'market-calendar', readiness: 'live', capabilities: { runNow: 'job', testConnection: false }, requiresProxy: true }),
      src({ purposes: ['calendar'], sourceId: 'macro-calendar-0xrouter-financial-events', summaryKey: 'settings.intelligenceSources.sourceSummary.macro-calendar-0xrouter-financial-events', displayName: 'Market calendar · financial events', collection: 'job', kind: 'market-calendar', readiness: 'live', capabilities: { runNow: 'job', testConnection: false }, requiresProxy: true }),
      src({ purposes: ['calendar'], sourceId: 'macro-calendar-0xrouter-central-bank-activities', summaryKey: 'settings.intelligenceSources.sourceSummary.macro-calendar-0xrouter-central-bank-activities', displayName: 'Market calendar · central bank activities', collection: 'job', kind: 'market-calendar', readiness: 'live', capabilities: { runNow: 'job', testConnection: false }, requiresProxy: true }),
      /* 备源（用户 2026-11-17：「旧源给我加回来，互相补充，新的覆盖旧的」）：它重新声明`etf-net-flow`
         并按作业采——主源 CryptoETF 不可用时由刷新链的优先级解析退到它；两个都开着不再冲突。
         数据行仍按各自来源打标，窗口契约不允许混源，所以同一轮永远只有一个源的窗口。 */
      src({ purposes: ['dashboard', 'briefing'], sourceId: '0xrouter-aggregate-provider', summaryKey: 'settings.intelligenceSources.sourceSummary.0xrouter-aggregate-provider', displayName: '0xRouter aggregate market', provides: ['etf-net-flow'], collection: 'job', readiness: 'live', capabilities: { runNow: 'none', testConnection: true }, adapterRef: '0xrouter-aggregate-provider', requiresProxy: true }),
    ]
  })

/**
 * 三路日历源的 id：从上面的定义**现算**，不让人在 agent 分组里再抄一遍。
 *
 * 「面板 ⊆ agent」那条守卫要求：日历面板里出现的源，crypto agent 必须能读。所以 agent 分组展开这一份；
 * 加第四路日历源时它自动进组，不会出现「面板有、agent 没登记」的漏项。
 */
export const zeroXRouterCalendarSourceIds: readonly string[] = zeroXRouterProvider.sources
  .filter((source) => source.purposes?.includes('calendar') === true)
  .map((source) => source.sourceId)
