/**
 * 平台自己的「发送测试通知」按钮（设置页那颗通用按钮）。
 *
 * **平台只认一种测试**：`link` —— 通知链路自检。不取任何产品的数据、不带产品概念；
 * 走完整真实链路（含手机通道），固定样例，正文带【测试】标记。
 *
 * 为什么这里只剩它：平台不认识「舆情」「日历」这些词。那些按钮的取数属于产品，由产品自己的
 * IPC 拼好请求、调现有提交入口，平台不需要为它们开契约（用户 2026-11-08 定）。
 */
export type LinkSelfTestKind = 'link'

/** 三档回执的闭集：`sent` 必带通道名（成功句「已发到 {通道名}（测试）」要有来源）。 */
export type TestNoticeReceipt =
  | { state: 'sent'; channelId: string; channelName: string }
  | {
    state: 'unavailable'
    /**
     * `collapsed` / `merged` / `delegated` 是**结果**，不是失败：读者点的那一下没产生投递，
     * 就不许回「已发到 X」。三条各自报，别默认落进 sent。
     * `suppressed` = 这一档**根本没被尝试**（免打扰或开关关着）：回执说「没测」，不说「没到」。
     */
    reasonCode: 'push-unavailable' | 'read-failed' | 'collapsed' | 'merged' | 'delegated' | 'suppressed' | 'rejected'
    /**
     * `rejected` 与 `read-failed` 是两件事：前者是**提交被门禁/批准表拒了**（有样例、没让发），
     * 后者是**读不到样例**（没有可发的内容）。以前把两者合成 `read-failed`，于是同一个码盖两种病，
     * 读者看到「读失败」去查数据，真正的问题是这条事件没被批准（2026-11-10）。
     */
    /** 只在 `push-unavailable` 上出现：当时实际 `runtime-ready` 的通道条数（0 或 ≥2）。 */
    enabledChannelCount?: number
  }
