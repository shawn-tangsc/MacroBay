/**
 * 通知事件目录（契约 §2–§4）：产品与平台**声明**事件，平台**批准**档位，读者只看到目录里有的。
 *
 * 边界：`platform/**` 不许 import 产品代码。所以目录只接受**注入**的声明列表——装配层把平台
 * 事件表与各产品 manifest 里的声明一起传进来，目录本身不认识任何产品。
 *
 * **生效值只读批准表**（契约 §4）：产品写了申请，平台没批，行为不变。登记时校验
 * 「申请 ⊆ 批准」（`channel` 例外：没批按未批准处理，不报错——否则产品要改一版 manifest 才能上架）。
 */

/** 三个本机落点。center 恒在，不可申请、不可关闭。 */
export type NotificationDisruptionLevel = 'toast' | 'popup' | 'desktop'
/** 申请侧：三个本机落点 + 一条出站通道。 */
export type NotificationRequestedLevel = NotificationDisruptionLevel | 'channel'
/** 生效侧：多一个恒在的 center（批准表可以写它，申请侧不行）。 */
export type NotificationApprovedLevel = NotificationRequestedLevel | 'center'

/** 声明（产品 manifest 与平台事件表同形，只是声明者不同）。 */
/** 类型标签的四值闭集（中文译法只认界面规范 §3：失败 / 要你处理 / 完成 / 提醒）。 */
export type NotificationCategory = 'failure' | 'needs-action' | 'completed' | 'reminder'

export type NotificationEventDeclaration = {
  /** 必须 `<productId>.` 前缀；id 的唯一出处是 `notification-event-ownership.md`。 */
  id: string
  /** 标题/正文的 i18n 键；句子由注入的解析端口按读者语言产出。 */
  titleKey: string
  bodyKey?: string
  bodyKeyByVariant?: Readonly<Record<string, string>>
  /** 「为什么推了」那一句，必填：没有收据就没法解释。 */
  reasonKey: string
  /** 读者要不要动手：决定提交期 `actions` 能不能是空数组，不是「一定有动作」。 */
  requiresUserAction: boolean
  /**
   * 读者面向的类型标签（契约 v2.38）：**只能声明、不许推导**。
   *
   * 判据只有一条：**一次性（failure）还是一直不对劲（needs-action）**；`completed` 是"好了/做完了"，
   * `reminder` 是"发生了但你不用动手"。**「错误对读者可见、能重试」只是 `failure` 的典型样子，
   * 是说明、不参与判定**——只要它还叫"必要条件"，就仍在参与判定，N6 那类事件上能得出相反结论。
   *
   * 不许从 `severity`/`actions`/`requiresUserAction`/文案键反推：`severity` 在计划器里两处写死 `info`，
   * 推出来所有事件同一个标签——比推错更难发现。
   */
  category: NotificationCategory
  requestedDisruptionLevels: readonly NotificationRequestedLevel[]
  dedupeKeyTemplate?: string
  dedupeKeyBuilder?: 'moduleSignal' | 'sourceIssue'
  /** 键的粒度：一次发生（occurrence）还是一个持续状况（condition）。 */
  dedupeUnit: 'occurrence' | 'condition'
  conditionWindowMs?: number
  requestedBypassQuietHours?: boolean
  /**
   * 每天最多发几条，按 **UTC 自然日**分桶。缺省＝不限。
   *
   * 判在提交计划器**一处**，计数由平台从通知记录本身数（`sameEventToday`），生产者不许自己数：
   * 再数一遍就是第二套阈值，两边一漂，读到的条数和实际发出去的对不上。
   * 用 UTC 日而不是读者的「今天」，否则改一下时区就能多拿额度。
   */
  dailyLimit?: number
  /**
   * 相邻两条之间至少隔多久（毫秒），与 `dailyLimit` 配套，缺省＝不限。
   *
   * 「6 小时冷却」这类要求走这里，不写进生产者的判断——同一条规矩只允许有一个执行者。
   */
  minimumGapMs?: number
  deprecated?: boolean
}

/** 声明 + 批准值 + 归属：界面与运行时读的是这一份（一处合并，别处只引用）。 */
export type NotificationEventCatalogEntry = NotificationEventDeclaration & {
  /** 声明者：平台事件是 `platform`，产品事件是它的 productId（从 id 前缀取，不由声明自带）。 */
  productId: string
  approvedDisruptionLevels: readonly NotificationApprovedLevel[]
  approvedBypassQuietHours: boolean
}

export type NotificationEventCatalog = {
  has: (id: string) => boolean
  get: (id: string) => NotificationEventCatalogEntry | undefined
  list: () => readonly NotificationEventCatalogEntry[]
}

export type NotificationEventDeclarationSource = {
  /** `platform` 或产品的 productId（必须等于声明 id 的前缀）。 */
  productId: string
  events: readonly NotificationEventDeclaration[]
}

export type NotificationEventPolicyEntry = {
  approvedDisruptionLevels: readonly NotificationApprovedLevel[]
  approvedBypassQuietHours: boolean
}

export type NotificationEventPolicy = Readonly<Record<string, NotificationEventPolicyEntry>>

const REQUESTED_LEVELS: readonly NotificationRequestedLevel[] = ['toast', 'popup', 'desktop', 'channel']

/**
 * 建目录。校验在**登记时**做（不是提交时）：一份坏声明不该等到某天有人提交才发现。
 *
 * 校验四件：
 *  1. id 必须带 `<productId>.` 前缀（否则归属判不出，键也拼不对）；
 *  2. id 唯一（两个人登记同一个 id，合并时就没人说得清这是谁的事）；
 *  3. 申请档位都在闭集里、且不含 `center`；
 *  4. 申请 ⊆ 批准（`channel` 例外，见契约 §4）。
 */
export function createNotificationEventCatalog(input: {
  sources: readonly NotificationEventDeclarationSource[]
  policy: NotificationEventPolicy
}): NotificationEventCatalog {
  const entries: NotificationEventCatalogEntry[] = []
  const byId = new Map<string, NotificationEventCatalogEntry>()

  for (const source of input.sources) {
    for (const declaration of source.events) {
      if (!declaration.id.startsWith(`${source.productId}.`)) {
        throw new Error(`notification-event-prefix-mismatch:${source.productId}:${declaration.id}`)
      }
      if (byId.has(declaration.id)) {
        throw new Error(`notification-event-duplicate-id:${declaration.id}`)
      }
      // 数与冷却只接受正整数：0 会把「每天 0 条」变成永远静默，负数更没有意义。
      // 校验放在登记时，坏声明不该等到某天有人提交才发现。
      if (declaration.dailyLimit !== undefined &&
        (!Number.isSafeInteger(declaration.dailyLimit) || declaration.dailyLimit < 1)) {
        throw new Error(`notification-event-invalid-daily-limit:${declaration.id}:${String(declaration.dailyLimit)}`)
      }
      if (declaration.minimumGapMs !== undefined &&
        (!Number.isSafeInteger(declaration.minimumGapMs) || declaration.minimumGapMs < 1)) {
        throw new Error(`notification-event-invalid-minimum-gap:${declaration.id}:${String(declaration.minimumGapMs)}`)
      }
      for (const level of declaration.requestedDisruptionLevels) {
        if (!REQUESTED_LEVELS.includes(level)) {
          throw new Error(`notification-event-invalid-requested-level:${declaration.id}:${String(level)}`)
        }
      }
      const policy = input.policy[declaration.id]
      // 没有批准记录 = 只进中心（契约 §4 第二句）：**不报错**，因为「还没批」是合法状态，
      // 生效值本来也只读批准表。只有「有批准行、却和申请对不上」才是签过的表和声明打架，必须红。
      const approvedDisruptionLevels = policy?.approvedDisruptionLevels ?? ['center']
      if (policy !== undefined) assertRequestedWithinApproved(declaration, approvedDisruptionLevels)
      const entry: NotificationEventCatalogEntry = Object.freeze({
        ...declaration,
        productId: source.productId,
        approvedDisruptionLevels: Object.freeze([...approvedDisruptionLevels]),
        approvedBypassQuietHours: policy?.approvedBypassQuietHours === true
      })
      entries.push(entry)
      byId.set(entry.id, entry)
    }
  }

  return Object.freeze({
    has: (id: string) => byId.has(id),
    get: (id: string) => byId.get(id),
    list: () => entries
  })
}

function assertRequestedWithinApproved(
  declaration: NotificationEventDeclaration,
  approved: readonly NotificationApprovedLevel[]
): void {
  const approvedSet = new Set<NotificationApprovedLevel>(approved)
  for (const level of declaration.requestedDisruptionLevels) {
    // `channel` 的唯一例外：产品申请了、平台没批 → 按未批准处理，不报错（契约 §4）。
    if (level === 'channel') continue
    if (!approvedSet.has(level)) {
      throw new Error(`notification-event-requested-not-approved:${declaration.id}:${level}`)
    }
  }
}
