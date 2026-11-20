import { marketCalendarPublicPolicy } from '../../../contracts/macro/marketCalendarQueryContracts'

/**
 * **标准表的表名与闭集**（从 `marketCalendarStandardTable` 抽出，2026-11-21）。
 *
 * 为什么单独一个模块：`marketCalendarStandardRowLedger` 要用表名，而表模块又转发台账函数——
 * 两文件互相 import 会成环。把「名字与闭集」放在最底层，两边都只依赖它。
 *
 * 一份口径只写一次：表名、发布状态闭集、身份种类、未映射原因都在这里，别在调用点再抄一份。
 */
export const calendarStandardTablePolicy = Object.freeze({
  eventsTable: 'mi_calendar_events',
  /** 日历的唯一读入口（只含 `row_kind = 'release'`）。 */
  releasesView: 'mi_calendar_releases',
  unmappedTable: 'mi_calendar_unmapped',
  /**
   * 「源内发布 id ↔ 标准行」的映射。**一行只能存一个 `source_event_id`**：源把同一身份同一天
   * 重发两次时，后写的会把前一个 id 覆盖掉，按 id 溯源的清单就会凭空少一条（实测 257 → 252）。
   * 这张表把每次发布都记下来，于是「清单里有、表里没有」能真的为 0，而不是靠一句解释。
   */
  sourceIdsTable: 'mi_calendar_event_source_ids',
  /**
   * 发布状态闭集，**从源拿**：读侧要分「已发布/排期/取消」不许按日期推——
   * 日期比会在发布当天中午前后判错（源还是 scheduled，日期已过）。
   */
  /**
   * 五态闭集（产品口径 2026-11-16）：`scheduled` 只用于「还没到发布日」；过期无值在 24h 窗口内是
   * `backfilling`（界面「待补值」），窗口外是 `missing`（「未提供」）。旧行的 `unknown` 保留读兼容，
   * 读侧按 `missing` 处理，不单开第六态。
   */
  /** 闭集**引用契约那一份**，这里不写字面量（守卫见 `marketCalendarReleaseStatusUnionGuard`）。 */
  releaseStatuses: marketCalendarPublicPolicy.releaseStatuses,
  /**
   * 身份种类。`code` = 标准码（可跨源合并）；`source` = **源内标识**（映射不上时用它，
   * 日历照常显示、但**不参与跨源合并**——没有共同身份，硬合就是猜）。
   *
   * 不进主键：两种身份的命名空间天然不重叠（标准码是 `US.*`/`evt.*`，源内标识是源的
   * `release_id`），所以主键 `(国家, metric_key, period, 首发布日)` 已经唯一。**不为它重建表**——
   * 重建要动主键和已有行，正是最容易藏数据的一步。
   */
  identityKinds: Object.freeze(['code', 'source'] as const),
  /** 没映射上的原因闭集。新增值要同时更新这里的注释与用例。 */
  // `bad-period` 是**只读遗留**（2026-11-18）：写入端已不再产生它，`period-unresolved` 取代了它。
  // 保留它只为读旧库的行——否则旧库那 120 条会变成「不认识的原因」。**不许再有新代码写它**。
  unmappedReasons: Object.freeze(['unknown-measure', 'unknown-event-type', 'bad-period', 'bad-identity',
    'unknown-release-group', 'ambiguous-same-day',
    /**
     * 有期间、但这次发布**一个 measure 都没有**（实测 11+12 月美国 21 条）。它写不出指标行
     * （没有 measure 就没有 `metric_key`），也不属于「映射不上」——所以要单独一个原因：
     * 前者要问源为什么发空发布，后者要补映射，修法不同。这条路径以前三无（表里没有、
     * `unmapped` 没有、日志也不说），发布层守恒式一上线就把它量出来了。
     */
    'no-values',
    /**
     * **身份缺国家**（2026-11-16 用户口径）：观测本身没带国家码，算不出「哪个国家的这次发布」。
     * 它和 `bad-identity` 是两件事：那个是「身份本身坏了」（拼不出三段），这个是「少了其中一段」。
     * 以前这类行**静默跳过**（既不进表、也不进未映射），1484 条就这么消失了——用户一句话点出：
     * 不落表可以，但**必须落在未映射的库里**，否则「筛掉了」被读成「没有」。
     */
    'missing-country',
    /**
     * **有国家、也有标题，但码表里找不到对应的码**（2026-11-18 Chief 定）：身份的三段算得出来，
     * 只是那一段（族/测度）还没有码。它和 `bad-identity` 的区别是「没建码」不是「拼不出来」，
     * 和 `bad-period` 的区别是「连码都没有」不是「有码缺期次」——三种修法不同，不能合成一个数。
     */
    'no-code',
    /**
     * **没有标准行**（2026-11-18 Chief 定）：这条源内身份当年因为缺国家被跳过，之后没有任何东西
     * 把它写进标准表——**它不在等映射，也没有行可挂映射**。留在「未映射」里会让那个数永远压不下去，
     * 也看不出真正缺什么：849 条里 751 条是这种，其中 642 条映射其实早就写好了。
     */
    'no-standard-row',
    /**
     * **已映射、源未给统计期**（2026-11-18 Chief 定）：有码缺期次，定位不到某一天，显示不出来。
     * 它不是「未映射」——映射那一半已经做完了，缺的是源没给的那一半，所以只作诊断、不进列表。
     * 这条口径与 `bad-period` 分开：那个是「码都没定」，这个是「码定了、期次没给」。
     */
    'period-unresolved'] as const)
})
