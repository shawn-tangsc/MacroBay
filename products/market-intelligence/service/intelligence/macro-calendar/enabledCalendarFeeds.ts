/**
 * 自动日历任务该刷哪些 feed：**只刷读者没关掉的那些**，没建过档案的默认开。
 *
 * 放在日历域里而不是装配根：这是一条日历规则（「没有档案 ≠ 关掉了」），装配根只该把源接上。
 * 每加一条 feed 只改这里一处，不必再进两百行的 registerServices 里找。
 */
export const AUTOMATIC_CALENDAR_FEED_IDS: readonly string[] = Object.freeze([
  'macro-calendar-0xrouter-economic-data',
  'macro-calendar-0xrouter-financial-events',
  'macro-calendar-0xrouter-central-bank-activities'
])

export function createEnabledCalendarFeeds(deps: Readonly<{
  listProfiles: () => Promise<readonly Readonly<{ sourceId: string; enabled: boolean }>[]>
}>): () => Promise<readonly string[]> {
  return async () => {
    const profiles = await deps.listProfiles()
    const byId = new Map(profiles.map((profile) => [profile.sourceId, profile.enabled]))
    return AUTOMATIC_CALENDAR_FEED_IDS.filter((id) => byId.get(id) !== false)
  }
}
