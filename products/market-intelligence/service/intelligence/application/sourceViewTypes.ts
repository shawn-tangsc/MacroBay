import type { MarketCalendarWriteFailureView } from '../../../contracts/macro/marketCalendarQueryContracts'
import type { AgentDefinition, PanelDefinition, ProviderDefinition, SourceCategory, SourceDefinition } from './providerRegistry'
import type { CalendarOfficialFeedsAvailability } from './officialCalendarAvailability'
import type { SourceHealthFact } from './sourceProjection'
import type { SourceStaleMeasurements } from './pipelineHealth'
import type { SourceStaleReason } from './sourceStaleness'

/**
 * 来源投影的**契约**：五态与目录标记的词汇、设置/面板/Agent 三种视图的形状、以及投影的输入。
 *
 * 与计算分开，是因为这两半的读者不同：改判据的人看 `sourceProjection.ts`（五态怎么判、
 * 一份事实怎么算），改界面形状的人看这里（一行上能读到什么）。合成一个文件时，想看
 * `SourceView` 有哪些字段要先翻过两百行派生逻辑——这个文件超 500 行就是这么来的。
 *
 * 这里**只有类型**：没有任何判据、默认值或句子。
 */

/**
 * 一个源对读者呈现的五态（C6，2026-11-10）：**全仓只在这里判一次**。
 *
 * - `healthy`：启用、可用、健康读数说 healthy → 绿；
 * - `repeated-failures`：降级且连续失败到阈值 → 红（「多次失败」，不是「数据偏旧」）；
 * - `stale`：降级但没到阈值 → 黄（「数据偏旧」）；
 * - `failed`：健康读数说 failed → 红；
 * - `off`：**不亮的那一档**——没启用，或已启用但现在取不到（`unavailable`，如 BLS 403），
 *   或根本没有健康读数。「没有数据不等于健康」，所以它也落这一档，而不是绿。
 *
 * `off` 只说**颜色上不亮**，不等于「读者关掉了」：不可用的读者用词由各自那句给（源行「不可用」），
 * 这一层不给词。
 */
export type SourceHealthState = 'healthy' | 'repeated-failures' | 'stale' | 'failed' | 'off'

/**
 * 目录标记档：**第二个通道（形状），但和五态出自同一处派生**（架构师 2026-11-10）。
 *
 * 消费者只拿这个值，不再自己看 `enabled && unavailable`——判据只有这里一份：
 * - `bad` / `warn` 直接来自五态（红/黄实心）；
 * - `ring` = **已启用且这个源判定不可用**。`off` 同时盖着「未启用 / 取不到 / 没有读数」，
 *   所以不能只按状态画环：未启用、没数据都落 `none`；
 * - `none` = 不画。
 */
export type SourceHealthMarker = 'none' | 'ring' | 'warn' | 'bad'

export type ProjectionState = {
  enabledById?: Readonly<Record<string, boolean>>
  healthById?: Readonly<Record<string, SourceHealthFact>>
  jobRegisteredById?: Readonly<Record<string, boolean>>
  /** Sources that already have a profile, including disabled ones. */
  knownSourceIds?: ReadonlySet<string>
  /** 源 id → 标准表写库失败（与 `healthById` 平行，不参与五态派生）。 */
  writeFailureById?: Readonly<Record<string, MarketCalendarWriteFailureView>>
  /** 源 id → 「还没写过」/「读不到」两态（与失败态互斥）。 */
  writeFailureStateById?: Readonly<Record<string, 'never-written' | 'unreadable'>>
  /**
   * 源 id → 采集**产出**状态（2026-11-21 事故）。与四张表都平行，**不参与任何派生**：
   * 采集成功不等于产出条目，把它并进 `healthState` 就等于让读者去查网络（见 `SourceView.staleReasons`）。
   */
  staleById?: Readonly<Record<string, Readonly<{
    staleReasons?: readonly SourceStaleReason[]
    staleMeasurements?: SourceStaleMeasurements
  }>>>
}

export type SourceView = SourceDefinition & {
  /**
   * 采集由谁负责（来自 catalog）：`product` = 产品自己的作业决定节奏，通用采集器不按预设跑。
   * UI 据此决定频率那一行显示文字还是下拉（用户 2026-11-12）。
   */
  collectionOwner?: 'adapter' | 'product'
  enabled: boolean
  jobRegistered?: boolean
  /** 五态结论，与其他面读的是同一个字段（见 `sourceHealthState`）。 */
  healthState: SourceHealthState
  /** 目录标记档，与五态同一处派生（见 `sourceHealthMarker`）；消费者不再自己判。 */
  healthMarker: SourceHealthMarker
  /**
   * 标准表**写库**失败（`f817070` / 架构师契约）：形状取自 `MarketCalendarWriteFailureView`，
   * **没有失败就不带这个键**。
   *
   * 与 `healthState` **并列**、绝不并进去：写库失败不是来源失败——把 `healthState` 拉成 `failed`，
   * 读者会去查网络与凭据，而真相是我们的库写不进去（用户 2026-11-19 定）。
   */
  writeFailure?: MarketCalendarWriteFailureView
  /**
   * 写库这一列另两态的**并列**陈述（用户 2026-11-19）：
   * `never-written` = 该写入方还没有任何写入记录（**空态**，不是「没失败」）；
   * `unreadable` = 读写入层失败（**错误态 + 重试**）。
   * 「有记录、没失败」不出现这个字段——这一列只有「失败」与「没失败」，没有「健康」评价。
   */
  writeFailureState?: 'never-written' | 'unreadable'
  /**
   * **采集有没有产出**（2026-11-21 事故，用户当天要求「设置里情报源健康那一行，把这两个状态
   * 显示出来」）：`no-output` = 该源已超过自己的正常间隔没有新内容；`normalize-failing` =
   * 抓到了但连续解析失败、没变成条目。可能同时为真，界面两条都显示、不挑一个。
   *
   * 与 `healthState` **并列**，理由和写库失败那一列相同：这两个病里 `healthState` 都是绿的
   * ——采集任务每次都成功，只是没有产出。并进去会让读者去查网络与凭据，而真相是「源不发了」或
   * 「我们的解析坏了」。没有这两个状态时不带这个键（不是「健康」评价，只是「没有可报的病」）。
   */
  staleReasons?: readonly SourceStaleReason[]
  /** 两句文案的插值数字（小时 / 次数）；只在对应原因存在时出现，界面不自己重算。 */
  staleMeasurements?: SourceStaleMeasurements
}

/** ProviderView 的目录标记：由它的源聚合，仍是同一份派生，组件不再二次判断。 */

export type ProviderView = {
  providerId: string
  displayName: string
  category: SourceCategory
  credential: ProviderDefinition['credential']
  /**
   * The source that owns the provider's credential and probe, taken from the provider registry so
   * it survives a panel that does not list that source (for example the calendar pane, where the
   * dashboard-only aggregate source is absent).
   */
  credentialSourceId?: string
  website?: string
  signupUrl?: string
  invite?: boolean
  /** 页头说明横幅的类别（见 `ProviderDefinition.notice`）。 */
  notice?: ProviderDefinition['notice']
  /**
   * 密钥块里那条四态常显行（未配置 / 已保存待验证 / 连接失败：原因 / 连接正常）。
   *
   * 与横幅分开：以前由 `notice: 'verification-only'` 兼任，副作用是「只验证密钥」的源连采集开关
   * 也被锁住——源一旦真能采集就错了。现在它是独立字段，注册表说显示就显示，和开关无关。
   */
  credentialStateLine?: ProviderDefinition['credentialStateLine']
  sources: SourceView[]
  /** 目录标记档（provider 级，源里最差的一档）。 */
  healthMarker: SourceHealthMarker
}

export type CategoryGroupView = {
  category: SourceCategory
  providers: ProviderView[]
}

export type SettingsView = {
  groups: CategoryGroupView[]
  counts: { total: number; enabled: number; pending: number; failed: number }
}

export type AgentGroupView = {
  groupId: string
  tier: AgentDefinition['groups'][number]['tier']
  sources: SourceView[]
}

export type AgentView = {
  agent: AgentDefinition
  groups: AgentGroupView[]
  counts: { groups: number; sources: number; enabled: number }
}

export type PanelView = {
  panel: PanelDefinition
  providers: ProviderView[]
  counts: { sources: number; enabled: number }
  /**
   * 官方日历腿的三态（只在经济日历这个面板上出现）。日历页据此把「来源全关 / 本月确实没有 /
   * 取不到」拆开；一处算、一处读——页面不再自己遍历注册表。
   */
  calendarOfficialFeeds?: CalendarOfficialFeedsAvailability
}
