/**
 * 渲染层看到的一条通知（从 `notificationContracts.ts` 拆出来：那份文件贴着 500 行线，
 * 而「记录长什么样」与「给渲染层的那一份长什么样」本来就是两件事）。
 *
 * 句子已由主进程在**读的那一刻**按当前界面语言解析；键与参数不在这份载荷里——渲染层拿不到键，
 * 就印不出 `notification.event.…` 这种串，不靠评审记得。
 */
import type { NotificationCategory } from './notificationEventCatalog'
import type { NotificationPosterEvidence } from './notificationPosterContracts'
import type { NotificationAction, SafeNotificationRecord } from './notificationContracts'

/**
 * 通知自带动作在界面上的样子：标签已经是句子，不再是键。
 *
 * 为什么动作标签也要在主进程解析：渲染层一旦拿得到 `labelKey`，它就得有一张文案表去查——
 * 那张表正是 `notification.event.…` 被印到屏幕上的入口。所以键与引用都不进这份载荷。
 */
export type NotificationCenterAction = Omit<NotificationAction, 'labelKey' | 'labelRef'> & { label: string }

/**
 * 渲染层看到的一条通知（落地约束 v1.2 §1）：句子已由主进程在**读的那一刻**按当前界面语言解析。
 *
 * 键与参数**不在这份载荷里**——渲染层拿不到键，就印不出 `notification.event.…` 这种串，
 * 不靠评审记得。记录本身仍存 ref（契约 §3.3），所以切了语言，历史通知跟着变。
 *
 * `category` 与 `createdAt` 是**结构字段**，不参与文案解析：文案解析失败、整条降级成兜底句时，
 * 它们照旧在——否则「点开看详情」只剩一句兜底句，等于点了没反应。
 */
export type NotificationCenterItem = Omit<
  SafeNotificationRecord,
  'titleKey' | 'titleParams' | 'bodyKey' | 'bodyParams' | 'reasonKey' | 'reasonParams' | 'actions'
> & {
  /** 标题句；解析不到时是平台兜底句，**不是键**。 */
  title: string
  /** 正文句；没有正文是空串。 */
  body: string
  /** 「为什么推了」的解析句；没有就省略，不拿键顶上。 */
  reason?: string
  /** 动作标签已解析；解析不出标签的动作整条不出现（按不动的按钮不该摆在读者面前）。 */
  actions: NotificationCenterAction[]
  /**
   * 类型标签（契约 v2.34）。目录里已经没有这条事件（旧记录、已撤事件）时没有标签——
   * 界面不编一个，缺失本身是事实。
   */
  category?: NotificationCategory
  /**
   * 「今天一共发生过 N 次」那一句；**只在真的合并过时才有**（`occurrenceCount > 1`）。
   *
   * 恒出会让读者看到「共 1 次」——一个他没见过的第二个东西，比不显示更糟。
   * 句子在主进程解析，渲染层拿到的就是这句话，不自己拼数。
   */
  occurrenceLabel?: string
  /**
   * 「手机这一档为什么没发出去」的唯一一句（多通道方案 §5-4）。**只在一种处境出现**：
   * 一条可用通道都没有（`failed` + `push-unavailable`）。别的失败处境各有各的逐通道结果，
   * 不在这里编一句通用话；逐通道的行等界面设计定稿后再画。
   *
   * 句子在主进程解析（与标题同一条口径），渲染层拿到的就是这句话。
   */
  deliveryHint?: string
  /** 海报这一行（#46）：整块缺席＝整行不出现；判读规则见 `notificationPosterContracts.ts`。 */
  poster?: NotificationPosterEvidence
}

