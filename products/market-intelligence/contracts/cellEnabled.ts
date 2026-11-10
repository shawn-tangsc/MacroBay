/**
 * 「格级启用」的读写契约（渲染层 ↔ 主进程）。
 *
 * 缺键 = 启用：`read()` 只回显式写过的格子，缺的键由调用方按「启用」处理；
 * 本契约不暴露默认值，也不让渲染层自己拼路径/文件。
 */
export type CellEnabledClient = Readonly<{
  read: () => Promise<Record<string, boolean>>
  write: (cellId: string, enabled: boolean) => Promise<void>
  /** 只回显式选过的格子；缺键 = 这一格没选过源（调用方按默认主源处理）。 */
  readSelection: () => Promise<Record<string, string>>
  /** 选一个源；`null` = 清掉这一格的选择。 */
  writeSelection: (cellId: string, sourceId: string | null) => Promise<void>
}>
