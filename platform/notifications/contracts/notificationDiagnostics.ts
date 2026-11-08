/**
 * 诊断出口的**条目形状**（runtime §2）。
 *
 * 从 `notificationContracts.ts` 拆出来：那个文件已经顶到 500 行硬线，而诊断条目增长的理由
 * （「哪种事实没人看就会变成黑箱」）与记录/设置契约完全不同。类型原样搬，行为零改动。
 */
import type { NotificationSubmitRejectionReason } from './notificationSubmitRejection'

/** 诊断出口：五类「没人看就会变成黑箱」的事实（runtime §2）。 */
export type NotificationDiagnosticsEntry = {
  code:
    | 'delegated'
    | 'unclaimed-producer'
    | 'claim-never-registered'
    /**
     * 这一侧**只剩一种文案失败**（契约 v2.56 收窄）：按挑选顺序挑不出可发的成品——
     * 两份都没有、或选中的那一段里有裸键 / 花括号 / 内部 id / 指向本条通知的动作词（平台**只拦不改**）。
     *
     * **不建 `copy-action-withheld`**（Chief 2026-11-06 裁定）：源头没提交的那段平台根本看不见，
     * 建一个永远没有实例的码比没有更糟；产品侧的留痕由产品自己打日志。
     */
    | 'copy-unresolved'
    /**
     * 动作标签解析不到，这条动作因此**不渲染**（v2.58）。带记录 id、动作 id 与键名，**不带句子**。
     *
     * 为什么必须记：标签是按钮的**名字**，名字没了按钮就凭空消失——读者只会以为「本来就没有」
     * 或「点过了」，而生产者那边一切正常。和 `copy-unresolved` 同一类：少一句话可以查，
     * 少一个入口不查就永远不知道。
     */
    | 'action-label-unresolved'
    | 'persist-failed'
    /** 提交**抛出**（读回坏了 / 规划器炸了 / 目录实现抛错）：与 `persist-failed` 互斥，同一失败只记一条。 */
    | 'submit-failed'
    /** 通道目标不唯一：`runtime-ready` 有 ≥2 条，推送按 fail closed 拒绝（技术方案 §1）。只记条数。 */
    | 'push-multiple-enabled'
    /**
     * 推送**根本没有钩子**（`deliveryHooks.push` 缺席）：装配漏了出站端口。读者侧仍只有
     * `push-unavailable` 一个码，这四个是**诊断**码，不进读者可见闭集。
     */
    | 'push-hook-missing'
    /** 推送**没有派生入口**（`resolvePushChannel` 缺席）：装配漏了这根线（2026-11-08 事故的形态）。 */
    | 'push-resolver-missing'
    /** 0 条通道：`channels.list()` 里就一条都没有——配置事实，不是瞬时失败。 */
    | 'push-target-none'
    /** 有通道、但没有一条是 `runtime-ready`：带状态直方图，说清「卡在哪种状态」。 */
    | 'push-target-not-ready'
    /**
     * 同一键的第二次提交想比**首次定档**更宽：按第一次（合并不升级），并记这一条。
     * 不记的话，生产者会遇到「我传了全档为什么只进中心」而毫无线索。
     */
    | 'narrowing-widened'
    /**
     * 读者点「推送到手机」在**判定阶段**被拒（记录不存在 / 版次不符 / 没通道 / 熔断中 / 表面非法）。
     * 这一支**不写记录**：`delivery.push` 只回答「推过没有」，没调用过通道就不该写。
     * 日志回答的是另一个问题——「这次操作发生了什么」，所以它必须是可查的一行。
     */
    | 'redeliver-rejected'
    /**
     * 同一组的两条通知，存量表面选择**不一致**（历史数据或半次写入）：读的时候按「都关」处理。
     * 记这一行是因为「都关」看起来跟读者自己关掉一模一样——不记，就没人知道少了什么。
     */
    | 'surface-selection-conflict'
    /** 提交被拒（`rejected`）**沿用拒绝码本身**，不发明第二个码：原因就是这行痕要回答的问题。 */
    | NotificationSubmitRejectionReason
  eventTypeId?: string
  producerId?: string
  /**
   * `copy-unresolved` 用：哪一条记录、哪个键、哪种语言解析不出来。
   * 用途是回答「这条为什么显示成兜底句」，**不是给读者看的**——它只进日志与开发工具。
   */
  recordId?: string
  key?: string
  /** `copy-param-missing` 用：消失的是哪一格参数（`taskName` 这类名字）。 */
  param?: string
  /** `redeliver-rejected` 用：拒绝码与**哪一步**拒的；`submit-failed` 用：错误类型名（不带 message）。 */
  reason?: string
  step?: 'surface' | 'target' | 'edition' | 'channel'
  language?: 'zh-CN' | 'en-US'
  /** `push-multiple-enabled` 用：当时处于 `runtime-ready` 的通道条数。**不记通道名、不记凭据。** */
  count?: number
  /** `push-target-not-ready` 用：**按状态**的通道条数（`{ 'runtime-ready': 0, 'credential-missing': 1 }`）。 */
  states?: Readonly<Record<string, number>>
  /** 只有「提交被拒」这一支自带档位（同一出口要记 `error` 与 `info`，规则见 `rejectionTraceLevel`）；其它码由装配层定。 */
  level?: 'info' | 'warn' | 'error'
  at: string
}
export type NotificationDiagnosticsSink = (entry: NotificationDiagnosticsEntry) => void
