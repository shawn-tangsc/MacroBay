/**
 * `import.meta.glob` 在主进程构建里的最小类型声明。
 *
 * 主进程由 Vite 构建，glob 是构建期展开的；tsconfig 只带 `node` 类型，没有 `vite/client`，
 * 所以这里补一个本地声明。运行时不会被调用——Vite 在编译期把 `import.meta.glob(...)` 替换成模块表。
 */
interface ImportMeta {
  glob: (pattern: string, options?: { eager?: boolean }) => Record<string, unknown>
}
