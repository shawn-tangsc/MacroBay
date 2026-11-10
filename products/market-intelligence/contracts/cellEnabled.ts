/**
 * 「格级启用」的读写契约（渲染层 ↔ 主进程）。
 *
 * 缺键 = 启用：`read()` 只回显式写过的格子，缺的键由调用方按「启用」处理；
 * 本契约不暴露默认值，也不让渲染层自己拼路径/文件。
 */
export type CellEnabledClient = Readonly<{
  read: () => Promise<Record<string, boolean>>
  write: (cellId: string, enabled: boolean) => Promise<void>
}>
