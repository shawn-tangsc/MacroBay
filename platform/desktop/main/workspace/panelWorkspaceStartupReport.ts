import type { WorkspaceDisposeReport, WorkspaceLayoutFlushReport, WorkspaceStartReport } from './composePanelWorkspace'

/**
 * Owner: platform/desktop/main/workspace / P1-06h（N4）。
 *
 * `composePanelWorkspace.start()` 的报告是**恢复/降级原因的唯一权威来源**（例如 `restore-invalid` 只出现在
 * `downgradedDetached` 里）。真机症状（P1-07 / N4）：app.ts 丢弃了返回值 ⇒ 恢复降级在运行期完全不可观测。
 *
 * 本模块只做「把受控报告变成日志行」这一件事：纯函数 + 注入 log，不 import electron、无顶层副作用、
 * 不读取文件/设置。日志只允许出现状态、计数、opaque 实例 id 与枚举原因词 —— 绝不输出路径、密钥或家目录。
 *
 * P1-06i（B）：上面这条约束不能只靠上游校验 —— 降级明细的 id 来自磁盘文档，必须在本模块**净化**：
 * 只有严格 opaque 形态（裸 uuid / `panel_`|`window_`|`workspace_` + 受限字符集与长度）才原样打印，
 * 其余一律 `<redacted>`；摘要计数不受影响。
 */

export type PanelWorkspaceStartLog = (message: string) => void

export type PanelWorkspaceStartReportInput = {
  report: WorkspaceStartReport
  /** 缺省写平台标准输出；测试注入 spy 断言被调用与字段完整。 */
  log?: PanelWorkspaceStartLog
}

/** 摘要行：一个字段都不省略（禁用态/无降级时同样如实写 0 与枚举词）。 */
export function formatPanelWorkspaceStartSummary(report: WorkspaceStartReport): string {
  const parts = [
    'panel workspace start:',
    `status=${report.status}`,
    `restore=${report.restore}`,
    ...(report.reason === undefined ? [] : [`reason=${report.reason}`]),
    `restoredPanels=${report.restoredPanels}`,
    `registrationFailures=${report.registrationFailures}`,
    `mayOverwrite=${report.mayOverwrite}`,
    `downgradedDetached=${report.downgradedDetached.length}`
  ]
  return `[workspace] ${parts.join(' ')}`
}

/**
 * P1-06i（B）：降级明细里的 `panelInstanceKey` 来自**磁盘上的布局文档**，上游（`panelLayoutDocument.ts`）
 * 只校验「非空、≤200、无控制字符」，因此它可能是路径、URL 或注入的密钥片段；逐字打印即日志泄露。
 *
 * 只有严格 opaque 形态才原样打印（运维可定位），其余一律 `<redacted>`：
 *  - 裸 uuid（`randomUUID()` 形态）；
 *  - 平台既有前缀 `panel_`/`window_`/`workspace_` + 受限字符集 `[A-Za-z0-9-]` 且后缀 ≤128
 *    （真实生成值即 `panel_<uuid>`；字符集不含 `/`、`\`、`.`、`:`、空白，因此路径/URL/家目录一律不可通过）。
 */
const OPAQUE_BARE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const OPAQUE_PREFIXED_ID = /^(?:panel|window|workspace)_[A-Za-z0-9-]{1,128}$/u
const REDACTED_PANEL_INSTANCE_KEY = '<redacted>'

/** id 净化的唯一判定（导出仅为聚焦单测；语义就是「严格 opaque 才可见」）。 */
export function sanitizePanelInstanceKey(panelInstanceKey: string): string {
  return OPAQUE_BARE_UUID.test(panelInstanceKey) || OPAQUE_PREFIXED_ID.test(panelInstanceKey)
    ? panelInstanceKey
    : REDACTED_PANEL_INSTANCE_KEY
}

/** 降级明细行（逐条）：只含净化后的 opaque panelInstanceKey、from→to 与枚举原因词。 */
export function formatPanelWorkspaceDowngrade(downgrade: WorkspaceStartReport['downgradedDetached'][number]): string {
  return `[workspace] restore-downgraded: panel=${sanitizePanelInstanceKey(downgrade.panelInstanceKey)} ${downgrade.from}->${downgrade.to} reason=${downgrade.reason}`
}

/** 把启动报告写进平台日志（摘要一行 + 每条降级一行）。 */
export function reportPanelWorkspaceStart(input: PanelWorkspaceStartReportInput): void {
  const log = input.log ?? ((message: string) => { console.log(message) })
  log(formatPanelWorkspaceStartSummary(input.report))
  for (const downgrade of input.report.downgradedDetached) log(formatPanelWorkspaceDowngrade(downgrade))
}

/**
 * P1-06m：**退出 flush 报告**（P1-07R 非阻塞项）。事实：布局落盘走 debounce（`boundsMergeMs` = 250ms，真机实测
 * 261ms），退出前 <debounce 的最后一次变更会停在待写槽；而 `app.ts` 过去把 `dispose()` 的返回值整个丢弃 ⇒
 * 运行期无法区分「flush 未跑」与「flush 跑输」。这里把受控报告变成**一行字段齐全的日志**：
 * `status` / `outcome` / `hadPendingWrites` / `layoutRevision`（`hadPendingWrites=true` 即证明退出时确实有
 * debounce 窗口内的待写被覆盖）。字段全是枚举词、布尔与计数 —— 绝无路径、URL、opaque id 或密钥。
 */
export function formatPanelWorkspaceFlushSummary(report: WorkspaceLayoutFlushReport): string {
  return [
    '[workspace] exit-flush:',
    `status=${report.status}`,
    `outcome=${report.outcome}`,
    `hadPendingWrites=${report.hadPendingWrites}`,
    `layoutRevision=${report.layoutRevision}`
  ].join(' ')
}

export function reportPanelWorkspaceFlush(input: { report: WorkspaceLayoutFlushReport; log?: PanelWorkspaceStartLog }): void {
  const log = input.log ?? ((message: string) => { console.log(message) })
  log(formatPanelWorkspaceFlushSummary(input.report))
}

/**
 * P1-06m：**退出 dispose 报告**（与 flush 报告同一份口径）。除 flush 结论外还如实记录退出期销毁的派生窗数量
 * 与撤销的 owner 数量（`mode=detached` 的窗口必须真的消失，报告是运行期唯一可见的判据）。
 * 禁用态的最小形状（缺省字段）按 `false/0` 兜底打印，绝不因为「没接线」而省字段。
 */
export function formatPanelWorkspaceDisposeSummary(report: WorkspaceDisposeReport): string {
  return [
    '[workspace] exit-dispose:',
    `status=${report.status}`,
    `flushOutcome=${report.flushOutcome}`,
    `hadPendingWrites=${report.hadPendingWrites ?? false}`,
    `layoutRevision=${report.layoutRevision ?? 0}`,
    `destroyedWindows=${report.destroyedWindows ?? 0}`,
    `ownersRevoked=${report.ownersRevoked ?? 0}`
  ].join(' ')
}

export function reportPanelWorkspaceDispose(input: { report: WorkspaceDisposeReport; log?: PanelWorkspaceStartLog }): void {
  const log = input.log ?? ((message: string) => { console.log(message) })
  log(formatPanelWorkspaceDisposeSummary(input.report))
}
