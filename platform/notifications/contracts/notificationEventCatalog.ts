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
  /**
   * 标题与理由的**变体**（契约 §3.2，2026-11-07 与 `bodyKeyByVariant` 同形补齐）。
   *
   * 为什么标题也需要变体：同一个事件在不同情形下标题的**语法**就不一样，不是填个参数能解决的。
   * 例如「美国 密歇根消费者信心初值 高于预期」在没有预期值时根本不成句——参数只有方向词的三个值，
   * 没有「不适用」这一档，硬塞就印出一句自相矛盾的话。理由同理：按重要性推送却写「达到意外阈值」，
   * 是一句假话。
   *
   * **不是 `rendered`**：那会把成品句子冻结进记录，以后改文案永远追不到历史。变体解析出的仍是
   * **键 + 参数**，措辞照旧由文案表给，历史跟着一起变好。
   */
  titleKeyByVariant?: Readonly<Record<string, string>>
  reasonKeyByVariant?: Readonly<Record<string, string>>
  /**
   * 声明者在源码里给这条事件起的**常量名**（如 `sampleEventLanded`）。
   *
   * 生产者门禁要靠它把源码里的 `SOME_TABLE.sampleEventLanded` 解析成事件 id。这份映射以前由平台
   * 去读产品的常量表文件获得——那等于平台认识产品的文件结构，产品挪一个文件平台就红。
   * 名字随声明走之后，平台只读声明，不读任何产品源码。
   */
  constantName?: string
  /** 「为什么推了」那一句，必填：没有收据就没法解释。 */
  reasonKey: string
  /** 读者要不要动手：决定提交期 `actions` 能不能是空数组，不是「一定有动作」。 */
  requiresUserAction: boolean
  /**
   * 这条事件的**批准档位与归组**——最终归声明者（`notification-event-declaration-shape.md` §1）。
   *
   * **迁移期的兜底形参，平台已经不读它**：生效值只来自各来源自己的 `approval`（契约 §7.1b）。
   * 留着它是为了让「删掉它必须红」这条反向验证有对象——b3-5 会连同兜底分支一起删。
   *
   * 为什么不新开一节放批准：`id` 已经在这个声明里出现一次，档位放到第二处就又是「同一件事两个
   * 声明处」，平台那张表曾经正是那个第二处（b3-3 已删）。
   */
  policy?: {
    approvedDisruptionLevels: readonly NotificationApprovedLevel[]
    approvedBypassQuietHours: boolean
    surfaceGroup?: string
  }
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
  /**
   * 事件级表面选择的**组键**（契约 §5.5）：同一件事的两条通知共用一个键、共用一份选择。
   * 只有一条成员时它等同于自己；两条时可用面取两条批准表的**交集**。
   */
  surfaceGroup?: string
}

export type NotificationEventCatalog = {
  /**
   * b2 观测点：这次装配里哪些条目**落到了平台表兜底**（来源没给 `approval`）。
   * 棘轮减到 0 时，连同 `policy` 参数与平台表一起删。
   */
  policyFallbacks?: () => readonly string[]
  has: (id: string) => boolean
  get: (id: string) => NotificationEventCatalogEntry | undefined
  list: () => readonly NotificationEventCatalogEntry[]
}

export type NotificationEventDeclarationSource = {
  /** `platform` 或产品的 productId（必须等于声明 id 的前缀）。 */
  productId: string
  events: readonly NotificationEventDeclaration[]
  /**
   * 这份来源自己的批准值（契约 §7.1b，2026-11-08）：**批准随声明走**，同一个 `productId` 只写一处。
   *
   * 迁移期它可以是 `undefined`——那样每条声明都会被 `notificationApprovalCoverage` 报成 `missing`，
   * 报数降到 0 之后才允许删平台表里的兜底。之后它改为必填（漏写编译期红）。
   */
  approval?: Readonly<Record<string, NotificationEventPolicyEntry>>
}

export type NotificationEventPolicyEntry = {
  approvedDisruptionLevels: readonly NotificationApprovedLevel[]
  approvedBypassQuietHours: boolean
  /**
   * 事件级表面选择的组键（契约 §5.5）：同一件事的两条通知写**同一个值**，读者的选择就只有一份。
   * 写在这里而不是另立一张组表：批准行是上限的唯一来源，组也属于上限，两处记必然漂移。
   */
  surfaceGroup?: string
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
  /**
   * **迁移期兜底**（契约 §7.1b）：来源没给某条 `approval` 时才读它。棘轮减到 0 时连同这个参数一起删。
   */
  policy?: NotificationEventPolicy
}): NotificationEventCatalog {
  const entries: NotificationEventCatalogEntry[] = []
  const byId = new Map<string, NotificationEventCatalogEntry>()
  /** 落到 `policy` 兜底的事件 id（b2 期间的观测点；棘轮减到 0 时连同兜底一起删）。 */
  const usedPolicyFallback: string[] = []

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
      // **来源优先**（契约 §7.1b 的 b2）：声明自己带的 `approval` 就是生效值；平台表降级成**兜底**，
      // 只在来源没给这一条时被读。兜底不是静默的：`usedPolicyFallback` 记下用的是哪几条，
      // 由调用方决定怎么报——静默兜底是这个项目反复踩的坑。
      const fromSource = source.approval?.[declaration.id]
      const policy = fromSource ?? input.policy?.[declaration.id]
      if (fromSource === undefined && policy !== undefined) usedPolicyFallback.push(declaration.id)
      // 没有批准记录 = 只进中心（契约 §4 第二句）：**不报错**，因为「还没批」是合法状态。
      // 只有「有批准行、却和申请对不上」才是签过的表和声明打架，必须红。
      const approvedDisruptionLevels = policy?.approvedDisruptionLevels ?? ['center']
      if (policy !== undefined) assertRequestedWithinApproved(declaration, approvedDisruptionLevels)
      const entry: NotificationEventCatalogEntry = Object.freeze({
        ...declaration,
        productId: source.productId,
        approvedDisruptionLevels: Object.freeze([...approvedDisruptionLevels]),
        approvedBypassQuietHours: policy?.approvedBypassQuietHours === true,
        ...(policy?.surfaceGroup === undefined ? {} : { surfaceGroup: policy.surfaceGroup })
      })
      entries.push(entry)
      byId.set(entry.id, entry)
    }
  }

  return Object.freeze({
    has: (id: string) => byId.has(id),
    get: (id: string) => byId.get(id),
    list: () => entries,
    /** b2 观测点：这次装配里哪些条目落到了平台表兜底（来源没给 `approval`）。不静默。 */
    policyFallbacks: () => Object.freeze([...usedPolicyFallback])
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
