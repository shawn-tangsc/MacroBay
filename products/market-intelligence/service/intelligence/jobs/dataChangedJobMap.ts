import type { PanelId } from '../application/providerRegistry'
import { getSource } from '../application/providerRegistry'
import { CROSS_ASSET_INDEX_COLLECT_JOB_ID } from '../cross-asset/crossAssetIndexJob'
import { CALENDAR_EVENT_REMINDER_JOB_ID } from '../macro-calendar/calendarEventReminderJob'
import { MACRO_MARKET_COLLECT_JOB_ID } from '../macro-market/macroMarketJob'
import { REAL_MARKET_API_DXY_COLLECT_JOB_ID } from '../macro-market/realMarketApiDxyJob'
import { MARKET_HISTORY_RETENTION_JOB_ID } from '../retention/marketHistoryRetentionJob'
import { INTELLIGENCE_COLLECT_SOURCE_JOB, INTELLIGENCE_JOB_IDS } from './intelligenceJobIds'

/**
 * 作业 → 「这次写入影响哪些面板 / 哪些来源」。
 *
 * 为什么落在**作业注册这一侧**：谁写库谁说自己写到了哪里；让读方去反推「这个 run 可能动了什么」，
 * 每加一个读方就要重推一次，迟早两处说法不一致。这张表就是 `intelligence.dataChanged` 的发射依据。
 *
 * 两条硬规矩：
 * - **每个会登记的产品作业都必须有一条**（含「不影响这两个面板」的显式条目）：查不到就是未登记，
 *   由发射器抛错（`dataChangedJobMap.test.ts` 逐 id 钉住，不许静默跳过）。
 * - **来源与面板都从注册表读**（`sourceCatalog` 的 `panels`），不在这里另写一张映射——
 *   「这个源供哪个面板」只有注册表一处事实。
 */
export type DataChangedTarget = Readonly<{ panels: readonly PanelId[]; sources: readonly string[] }>

const DASHBOARD: readonly PanelId[] = ['dashboard']
const CALENDAR: readonly PanelId[] = ['economic-calendar']
const NONE: DataChangedTarget = Object.freeze({ panels: Object.freeze([]), sources: Object.freeze([]) })

/** 精确 id → 影响面。空面（`NONE`）是**显式登记**，不是漏登记。 */
const BY_HANDLER_ID: Readonly<Record<string, DataChangedTarget>> = {
  // 采集：来源由 payload 给，面板由注册表给（见下方 `collectTarget`）。
  [INTELLIGENCE_COLLECT_SOURCE_JOB]: NONE,
  // 新闻/情绪管线写的是看板在读的库（情绪卡、分析证据）。
  'market-intelligence.normalizeRawRecords': { panels: DASHBOARD, sources: [] },
  'market-intelligence.assessChangedItems': { panels: DASHBOARD, sources: [] },
  'market-intelligence.refreshSentimentAggregates': { panels: DASHBOARD, sources: [] },
  'market-intelligence.reevaluateClusters': { panels: DASHBOARD, sources: [] },
  'market-intelligence.reevaluateSentimentScopes': { panels: DASHBOARD, sources: [] },
  'market-intelligence.enrichNewsDocuments': { panels: DASHBOARD, sources: [] },
  'market-intelligence.scoreNewsSentiment': { panels: DASHBOARD, sources: [] },
  'market-intelligence.translateItems': { panels: DASHBOARD, sources: [] },
  'market-intelligence.replayWindow': { panels: DASHBOARD, sources: [] },
  // 行情/自有作业：看板。
  [MACRO_MARKET_COLLECT_JOB_ID]: { panels: DASHBOARD, sources: [] },
  [REAL_MARKET_API_DXY_COLLECT_JOB_ID]: { panels: DASHBOARD, sources: [] },
  [CROSS_ASSET_INDEX_COLLECT_JOB_ID]: { panels: DASHBOARD, sources: [] },
  [MARKET_HISTORY_RETENTION_JOB_ID]: NONE,
  // 日历侧：经济日历面板。
  'market-intelligence.refreshMacroCalendar': { panels: CALENDAR, sources: [] },
  'market-intelligence.syncBlsScheduleAndValues': { panels: CALENDAR, sources: [] },
  'market-intelligence.refreshBeaOfficialReleases': { panels: CALENDAR, sources: [] },
  [CALENDAR_EVENT_REMINDER_JOB_ID]: NONE,
  // 只写日报/归档/维护，不在这两个面板里读。
  'market-intelligence.dailyBriefing': NONE,
  'market-intelligence.archiveCompaction': NONE,
  'market-intelligence.parquetExport': NONE,
  'market-intelligence.purge': NONE,
  'market-intelligence.reindex': NONE
}

/** 动态 handler：市场日历按 feed 派生 `${base}.${feedKey}`，前缀认。 */
const BY_HANDLER_PREFIX: ReadonlyArray<readonly [string, DataChangedTarget]> = [
  ['market-intelligence.refreshMarketCalendar', { panels: CALENDAR, sources: [] }]
]

/** 采集作业按 payload 的来源换面板；来源不在注册表里 → 空面（不是编一个面板）。 */
function collectTarget(payload: unknown): DataChangedTarget {
  const sourceId = typeof payload === 'object' && payload !== null && 'sourceId' in payload
    ? String((payload as { sourceId?: unknown }).sourceId ?? '')
    : ''
  if (sourceId === '') return NONE
  // 「这个源供哪个面板」只有注册表一处事实（`providerRegistry` 按 purposes 派生）。
  const source = getSource(sourceId)
  return Object.freeze({ panels: Object.freeze([...(source?.panels ?? [])]), sources: Object.freeze([sourceId]) })
}

/**
 * 一次运行的影响面：未登记的 handler 返回 `undefined`，由调用方**抛错**（不许静默跳过）。
 */
export function intelligenceDataChangedTarget(input: Readonly<{
  handlerId: string
  payload?: unknown
}>): DataChangedTarget | undefined {
  if (input.handlerId === INTELLIGENCE_COLLECT_SOURCE_JOB) return collectTarget(input.payload)
  const exact = BY_HANDLER_ID[input.handlerId]
  if (exact !== undefined) return exact
  const prefixed = BY_HANDLER_PREFIX.find(([prefix]) => input.handlerId.startsWith(prefix))
  return prefixed?.[1]
}

/** 守卫用：所有静态登记的 handler id（动态前缀另测）。 */
export const REGISTERED_DATA_CHANGED_HANDLER_IDS: readonly string[] = [
  ...INTELLIGENCE_JOB_IDS,
  CALENDAR_EVENT_REMINDER_JOB_ID,
  MACRO_MARKET_COLLECT_JOB_ID,
  REAL_MARKET_API_DXY_COLLECT_JOB_ID,
  CROSS_ASSET_INDEX_COLLECT_JOB_ID,
  MARKET_HISTORY_RETENTION_JOB_ID,
  'market-intelligence.refreshMacroCalendar',
  'market-intelligence.syncBlsScheduleAndValues',
  'market-intelligence.refreshBeaOfficialReleases'
]