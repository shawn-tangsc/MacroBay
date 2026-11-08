import type { NotificationEventDeclarationSource, NotificationEventPolicyEntry } from './notificationEventCatalog'

/**
 * **合并批准视图**（契约 §7.1b 的 b3 第 1 步）：唯一实现，只从传进来的 `sources` 算。
 *
 * 为什么要有它：平台那张批准表要被删掉，而仍然需要有人回答「这条事件生效的批准是什么」。
 * 视图把「每份来源自带的 `approval`」合成一份只读映射——**平台侧不需要 import 任何产品代码**，
 * 产品侧也只把自己那份传进来。
 *
 * 三条规则：
 * 1. **未批准的事件不出现在视图里**——不是默认 `center`。默认值会让人「没批」看起来像「批了中心」；
 * 2. 同一 id 在两边都给了批准且**值不一致** → **报错**（`approval-conflict:…`）。这条是**待架构师确认**的
 *    临时口径：不许实现时随手挑一边，挑哪边都会让「谁签的算数」变成实现细节；
 * 3. 值比较用规范化后的内容（档位排序、`surfaceGroup` 缺省为 `null`、`bypass` 必须显式布尔），
 *    与签名那套规范化保持同一个判据方向，避免「看起来一样其实不同」。
 */
export type ApprovalView = Readonly<Record<string, NotificationEventPolicyEntry>>

function canonical(entry: NotificationEventPolicyEntry): string {
  return JSON.stringify({
    levels: [...entry.approvedDisruptionLevels].sort(),
    bypass: entry.approvedBypassQuietHours === true,
    group: entry.surfaceGroup ?? null
  })
}

export function mergeApprovalView(sources: readonly NotificationEventDeclarationSource[]): ApprovalView {
  const merged: Record<string, NotificationEventPolicyEntry> = {}
  const seenIn = new Map<string, string>()
  for (const source of sources) {
    for (const [id, entry] of Object.entries(source.approval ?? {})) {
      const previous = merged[id]
      if (previous === undefined) {
        merged[id] = entry
        seenIn.set(id, source.productId)
        continue
      }
      // **同一 id 出现在两个来源就是错**，即使值恰好相同：那等于允许第二个来源替别人的事件批一次，
      // 今天相同、明天改不同就是一次无人发现的篡改。值相同与不同分两种文案，都是装配错误。
      const first = seenIn.get(id) ?? '?'
      if (canonical(previous) === canonical(entry)) throw new Error(`approval-duplicate-source:${id}:${first}|${source.productId}`)
      throw new Error(`approval-conflict:${id}:${first}|${source.productId}:levels=${String(previous.approvedDisruptionLevels)}|${String(entry.approvedDisruptionLevels)};bypass=${String(previous.approvedBypassQuietHours)}|${String(entry.approvedBypassQuietHours)};group=${String(previous.surfaceGroup ?? null)}|${String(entry.surfaceGroup ?? null)}`)
    }
  }
  return Object.freeze(merged)
}
