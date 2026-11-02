import type { WorkspaceSnapshot } from '@platform/workspace/contracts'

/**
 * 一次权威快照读取的结论。**「确实没有」与「拿不到」必须分开**：
 *
 * - `rejected`：宿主回了话并明确拒绝（本窗没有可承载的面板）—— 确实没有；
 * - `unavailable`：通道本身失败（调用抛错、响应畸形）—— 拿不到，面板可能仍在。
 *
 * 两者在界面上是两条不同的结论：前者说「这个窗口没有面板」，后者只能说「读不到状态」。
 * 合成一个 `null` 就等于把「拿不到」报成「没有」。
 */
export type WorkspaceSnapshotRead =
  | { status: 'ok'; snapshot: WorkspaceSnapshot }
  | { status: 'rejected'; reason: string }
  | { status: 'unavailable'; reason: 'transport-error' | 'invalid-payload' }

/**
 * 把一次未校验的响应归类成上面的结论。`readSnapshot` 由调用方注入：快照形状的**唯一**校验器在
 * `workspaceClient` 里，这里既不复制第二份，也不反向依赖它（避免循环依赖）。
 */
export function classifySnapshotRead(
  raw: unknown,
  readSnapshot: (value: unknown) => WorkspaceSnapshot | null
): WorkspaceSnapshotRead {
  const record = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : null
  if (record === null) return { status: 'unavailable', reason: 'invalid-payload' }
  if (record.status !== 'ok') {
    return { status: 'rejected', reason: typeof record.errorCode === 'string' ? record.errorCode : 'rejected' }
  }
  const snapshot = readSnapshot(record.snapshot)
  if (snapshot === null) return { status: 'unavailable', reason: 'invalid-payload' }
  return { status: 'ok', snapshot }
}
