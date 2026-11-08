/**
 * 提交被拒的**原因码**（契约 §6.1 的封闭集合，v2.57 起单列成文件）。
 *
 * 为什么从这里搬出来：它是一条**跨模块契约**（产品按码决定说什么），增长得比记录类型快；
 * 在 `notificationContracts.ts` 里它把那个文件顶过 500 行，而两者改动的理由完全不同。
 * 集合本身仍是封闭的：加一个码就是加一条契约，必须回产品签字。
 */
export type NotificationSubmitRejectionReason =
        | 'unknown-event-type'
        | 'cross-product-key'
        | 'missing-dedupe-key'
        | 'invalid-dedupe-vars'
        | 'unknown-body-variant'
        | 'missing-action'
        /**
         * `open-external` 动作没带 `url`：按钮点了没有地方可去。
         * 具名而不是通用 `invalid-action`，是为了让「哪一条动作错在哪」不用解析消息文本。
         */
        | 'external-action-without-url'
        /**
         * `url` 不是 http/https 绝对地址（`javascript:`、`file:`、相对路径都在这里）。
         * 打开一个本地路径或一段脚本，等于把一个点不动的按钮换成更糟的东西。
         */
        | 'external-action-bad-url'
        /** 不是 `open-external` 却带了 `url`：两个「外链」概念混用，读者点哪一个是猜的。 */
        | 'url-without-external-action'
        /** `open-external` 带 `deeplink`：应用内落点在手机上点不动，写出来就是一句做不到的话。 */
        | 'external-action-with-deeplink'
        | 'scope-mismatch'
        /**
         * `signalSeverity` 不在 `low|medium|high` 里（契约 v2.45）。
         *
         * 单列一个原因，是为了不让「展示严重度」那套值混进来：`critical` 排在最上面，一旦被当成
         * 最高档接受，第一次提交就把 `highestSeverity` 抬到顶，此后**再也不会有升级通知**，
         * 而表面上一切正常。宁可当场拒收，也不静默落成 `medium`。
         */
        | 'invalid-signal-severity'
        /** 源头没拼完：成品缺语言或某段为空串（契约 v2.56）。**不落库**——降级是少一句，拒收是不该发。 */
        | 'copy-missing'
        /**
         * 还在用旧的日内键形状（`moduleSignal` + `intraday` 却带着 `observedAt` / `bucketMs`）。
         * 单列一个原因，是为了让「你以为冷却生效了、其实每个桶都算一件事」当场可见。
         */
        | 'stale-signal-dedupe-vars'
        /**
         * 当日同类通知到了声明里的 `dailyLimit`（按 **UTC 自然日**算）。
         *
         * 单列一个原因，是为了让「今天为什么没提醒我」答得出话：没有这个码，被压掉的那条
         * 在记录里什么都不留，读者和排障两边都只能看到「没发生」。
         */
        | 'daily-limit-reached'
        /**
         * 声明了 `minimumGapMs`，同类上一条还在冷却里。
         *
         * 与 `daily-limit-reached` 分开，是因为两者该给的解释不同：一个是「今天说满了」，
         * 一个是「刚说过，等一下再说」。
         */
        | 'minimum-gap-active'
        /**
         * `narrowedDisruptionLevels` 里出现**批准表没有批**的档位。
         *
         * 收窄只能**变少**，不能**变出**。「传了却发不出去」如果按「与批准求交」静默处理，
         * 生产者会以为那一档发出去了——那正是今晚一直在清的静默失败。所以当场拒收，
         * 与 `assertRequestedWithinApproved` 对「申请了未批准的档位」的处理保持一致。
         */
        | 'surface-not-approved'

/** 这一条提交被拒的回执：码给机器、句子给人（诊断与日志用，不进读者界面）。 */
export type NotificationSubmitRejection = {
  kind: 'rejected'
  reason: NotificationSubmitRejectionReason
  message: string
}

/**
 * 被拒留痕的级别：**按「谁的问题」分档，不按严重程度**（Chief 2026-11-08 定）。
 *
 * 读者侧的正常抑制——今天说满了（`daily-limit-reached`）、刚说过还在冷却（`minimum-gap-active`）——
 * 是系统按读者自己声明的上限在正常工作，记 `info`；把它记成 `error` 会让真故障淹在狼来了里。
 * 其余全部是**契约被写错**（未知事件、缺动作、成品不全、键或严重度非法……）正常永远不该出现，记 `error`。
 * 缺省朝 `error` 倒：新增一个拒绝码忘了分档时宁可吵一次，也不要静默吞掉。
 */
export function rejectionTraceLevel(reason: NotificationSubmitRejectionReason): 'info' | 'error' {
  return reason === 'daily-limit-reached' || reason === 'minimum-gap-active' ? 'info' : 'error'
}

