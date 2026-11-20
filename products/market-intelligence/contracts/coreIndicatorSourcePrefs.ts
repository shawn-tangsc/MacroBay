/**
 * 「指标 × 源」第二层配置的读写契约（渲染层 ↔ 主进程）。
 *
 * 缺键 = 开：`read()` 只回显式关掉的键，缺的键由调用方按「开」处理（新增指标/新增源不会一进来全是空）。
 * 本契约不暴露默认值，也不让渲染层自己拼路径或文件。
 */
export type CoreIndicatorSourcePrefsClient = Readonly<{
  read: () => Promise<Record<string, boolean>>
  write: (preferenceKey: string, enabled: boolean) => Promise<void>
}>
