import { allSources } from './providerRegistry'

/**
 * 「官方日历腿现在是什么处境」——一处算、一处读（经济日历页的两/三态拆分用）。
 *
 * 日历页要把整页空框拆成「来源全关」与「本月确实没有」，而「官方腿有没有启用」是注册表 + 读者配置
 * 的事，属于本侧；页面不该自己遍历 `providerRegistry` 再判一次（两边各算一次迟早漂）。
 *
 * 三态而不是布尔，因为「停用」与「取不到」不是一回事：
 * - `disabled`：官方腿**全部未启用**——读者把它关了，去启用就能恢复；
 * - `enabled`：至少有一条**可用且已启用**的官方腿——有没有内容交给月投影回答；
 * - `unavailable`：没有可用且启用的腿，但存在**已判定不可用**的腿（今天只有 BLS，官方站 403、
 *   自动同步已停）。这一支不许落进 `disabled`（那不是读者关的），也不许算成「本月没有」。
 *
 * 判据只读注册表的 `unavailable` 与读者的 `enabled`，不碰健康记录、不碰采集状态。
 */
/**
 * 官方日历腿的 `sourceId` 集合：**从注册表派生，不在这里抄第二份**。
 *
 * 判据就是注册表的那两个字段（`kind: 'official-calendar'` 且挂在这张面板上），与「哪些源算官方日历腿」
 * 的定义同处一地——哪天加第四条官方源，这里自动跟上，不会静默漏掉。原来这里是一份写死的三条清单，
 * 加源的人只要没同时改这里，这一档就会把新源当成"不是官方腿"（`disabled` 判错、也永远等不到它可用）。
 *
 * 钉住的地方在用例：`officialCalendarAvailability.test.ts` 里逐字写着那三条 `sourceId`，注册表真变了
 * 它会红——提醒看的人「官方腿的集合变了，三态口径要不要一起看」。
 */
export const OFFICIAL_CALENDAR_SOURCE_IDS: readonly string[] = Object.freeze(
  allSources()
    .filter((source) => source.kind === 'official-calendar' && source.panels.includes('economic-calendar'))
    .map((source) => source.sourceId)
)

export type CalendarOfficialFeedsAvailability =
  | Readonly<{ state: 'disabled' }>
  | Readonly<{ state: 'enabled' }>
  | Readonly<{ state: 'unavailable'; reasonCode: string }>

export type OfficialCalendarFeedView = Readonly<{
  sourceId: string
  enabled: boolean
  unavailable?: Readonly<{ reasonCode: string }>
}>

export function officialCalendarFeedsAvailability(
  sources: readonly OfficialCalendarFeedView[]
): CalendarOfficialFeedsAvailability {
  const official = sources.filter((source) =>
    (OFFICIAL_CALENDAR_SOURCE_IDS as readonly string[]).includes(source.sourceId))
  /*
   * 顺序写死，别换：
   * 1. **一条都没启用** → `disabled`。这是「读者关的」，动作是去启用；全新安装就落这一档，
   *    不能因为 BLS 有那份"取不到"声明就说成不可用（那会让读者以为启用也没用）。
   * 2. 有**可用且启用**的腿（启用 **且** 没有不可用声明）→ `enabled`。
   * 3. 否则：读者确实启用了腿，但没有一条能用（今天就是只剩 BLS）→ `unavailable`。
   */
  if (!official.some((source) => source.enabled)) return Object.freeze({ state: 'disabled' })
  if (official.some((source) => source.enabled && source.unavailable === undefined)) return Object.freeze({ state: 'enabled' })
  const broken = official.find((source) => source.enabled && source.unavailable !== undefined)
  return Object.freeze({ state: 'unavailable', reasonCode: broken?.unavailable?.reasonCode ?? 'source-unavailable' })
}
