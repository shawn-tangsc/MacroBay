import { narwhalSourcePolicy } from '../application/narwhalSourcePolicy'
import { narwhalCanonicalIdentityKey, toAlpha2Country, zeroXRouterCanonicalIdentity } from './marketCalendarMetricIdentity'
import type { PublishWindow } from './marketCalendarPublishWindow'

/**
 * **每个观测来源怎么读它自己的行**（从 `marketCalendarStandardBackfill.ts` 抽出来的聚焦模块，
 * 2026-11-21 文件体积门禁：那张表原本把回填主流程顶到 502 行）。
 *
 * 这里只有两张按来源填的表与它们依赖的行形状：**加一个来源＝加一行**，判据不会长到循环里，
 * 也不会出现「这条来自谁都走不同逻辑」的分支——分流仍然只有 `routeStandardRelease` 一处。
 */

export const legacyObservationProviderId = '0xrouter' as const
export type StandardBackfillProviderId = typeof narwhalSourcePolicy.providerId | typeof legacyObservationProviderId

export type ObservationRow = Readonly<{
  source_event_id: string
  market_fact_key: string | null
  display_name: string | null
  country_code: string | null
  indicator_id: string | null
  event_kind: string | null
  scheduled_date: string | null
  scheduled_at: string | null
  consensus_json: string | null
  provider_previous_json: string | null
  provider_actual_json: string | null
  importance: string | null
  measure_keys_json: string | null
  last_seen_at: string | null
}>

export const hasMeasures = (json: string | null): boolean =>
  json !== null && json !== '' && json !== '[]' && json !== 'null'

/**
 * 每个来源**怎么读它自己的东西**：身份从哪解、有没有值、解不出身份算不算坏数据。
 *
 * 这是一张按来源填的表，不是散在各处的 `if (来源 === …)`：加一个来源＝加一行，判据不会长到
 * 循环里，也不会出现「这条来自谁都走不同逻辑」的分支。分流仍然只有 `routeStandardRelease`。
 */
export type BackfillSourceProfile = Readonly<{
  /** `windows`：该来源每个指标 id 的发布窗口（从历史发布日现算），月粒度用来判「延迟/终值」。 */
  readIdentity: (row: ObservationRow, windows: ReadonlyMap<string, PublishWindow>) => string | undefined
  /** 身份解不出＝这条发布算不出身份（新源把身份写进了 `market_fact_key`）。 */
  identityRequired: boolean
  hasValues: (row: ObservationRow) => boolean
  /** 旧源只补历史：同一身份已经被别的来源写过就不覆盖。 */
  skipIdentitiesOwnedByOthers: boolean
  /**
   * 观测表里那一列 `importance` 是不是**事实**。
   *
   * 观测表的这一列是 `not null`，Narwhal 那侧没有重要性字段，写入时只能填一个占位值——
   * 它不是源说的，复制进标准表就等于把我们自己编的 `medium` 当成来源判断，读者会以为
   * 「这条不重要」。所以 Narwhal 造假的那一份不复制（保持 NULL＝未提供），官方源那份照抄。
   */
  importanceIsFact: boolean
  /**
   * **N1：这一源先在适配器里解析数值**（架构师方案 §6）。解析只发生在这里——写入口只收结构化结果；
   * 没开的源（N2 再逐个接）走 `numericJson` 缺省，落 `unparsed`/`missing`，绝不回退去 parse 展示串。
   */
  parseNumeric?: boolean
}>

export const backfillSourceProfiles: Readonly<Record<StandardBackfillProviderId, BackfillSourceProfile>> = {
  [narwhalSourcePolicy.providerId]: {
    readIdentity: (row) => row.market_fact_key === null ? undefined : narwhalCanonicalIdentityKey(String(row.market_fact_key)),
    identityRequired: true,
    hasValues: (row) => hasMeasures(row.measure_keys_json),
    skipIdentitiesOwnedByOthers: false,
    importanceIsFact: false,
    // N1：narwhal 先接（单源内就能算）；旧源留给 N2。
    parseNumeric: true
  },
  // 旧源：身份在 `indicator_id` 那张表里；多数行本来就没有共同身份
  // （讲话、会议、没登记过的小指标），那是「走源内身份」，不是坏数据。
  [legacyObservationProviderId]: {
    /**
     * **期次在写入时就归一**（用户 2026-11-17 定；Chief 2026-11-17 落在这一层）。
     *
     * 这里原来直接把 `zeroXRouterCanonicalIdentity` 算出的 `periodKey` 当身份的一部分，而那个值
     * 是**发布时刻**（`2026-11-16T13:30`）或「发布日的上一月」——都不是期次。真期次只隐含在源标题里
     * （`… (Sep)`、`11月纽约联储制造业指数`）。不在这里改，每个采集周期都会重新写进一批假期次，
     * 启动时那两条按缺口扫的迁移只能一直跟在后面擦。
     *
     * 三条规则：
     * - 标题解得出 → 用解析值（`periodFromSourceTitle` 认英文月份/季度，也认 `11月` / `第三季度`）；
     * - 解不出 → `unknown:<国家>~<指标码>~<发布日>`：语义是**明确缺失**，同一发布的所有行共用一个值
     *   （中英两条、初值/终值两条本来就是一回事），因此仍会合并成一行；分隔符不用 `|`，
     *   那个是身份串的分隔符，混进去会把身份拆错；
     * - 事件码（`evt.*`）不解析标题：期次就是活动当天，由下游 `routeStandardRelease` 按
     *   `scheduledAt` 取到分钟。
     *
     * 国家码同一处归一到 alpha-2：身份串是这个值的第一处落地，留着三位写法会与写库后的两位
     * 对不上，认回身份时又认不回来。
     */
    readIdentity: (row, windows) => {
      const identity = zeroXRouterCanonicalIdentity({ countryCode: row.country_code, indicatorId: row.indicator_id,
        scheduledAt: String(row.scheduled_at ?? ''),
        ...(row.indicator_id === null ? {} : { window: windows.get(String(row.indicator_id)) }) })
      if (identity === undefined) return undefined
      const countryCode = toAlpha2Country(identity.countryCode)
      /**
       * 期次**在这里只放规则算出的那个**，不贴标题（2026-11-21）：源标题优先与「与声明冲突记缺」
       * 统一放到循环里判一次（`titlePeriod` 与 `rulePeriod` 比较）。贴在这里的话，标题会先把
       * 规则值盖掉，冲突就再也看不见了——实测「标题 (Sep)、声明 10 月」那条会照写 2026-09。
       */
      const periodKey = identity.metricKey.startsWith('evt.')
        ? String(row.scheduled_at ?? '').slice(0, 10)
        : identity.periodKey
      return `${countryCode}|${identity.metricKey}|${periodKey}`
    },
    identityRequired: false,
    hasValues: (row) => [row.consensus_json, row.provider_previous_json, row.provider_actual_json]
      .some((value) => value !== null && value !== ''),
    // 新口径：**来源同权**。这里原来是「新源写过的不覆盖」——那是来源优先级的旧实现，
    // 与用户定的「谁拿到非空值谁写、后到的覆盖」直接冲突，所以对所有来源一律 false。
    skipIdentitiesOwnedByOthers: false,
    importanceIsFact: true
  }
}