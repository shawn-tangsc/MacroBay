import { copyFileSync, existsSync, rmSync } from 'node:fs'

import { createNewsSentimentSqliteStore, type NewsSentimentStore } from './newsSentimentStore'

export type QuarantineNewsSentimentStorageDeps = Readonly<{
  copy?: (from: string, to: string) => void
  remove?: (path: string) => void
  now?: () => number
}>

/**
 * 读者主动重建前，把现有库文件（含 `-wal`/`-shm`）复制成 `.corrupt-<stamp>` 现场。
 * **复制全部成功后才移除原件**：任何一步失败都抛，调用方据此中止，不在没保住原件时建新库。
 * 文件不存在时返回 `undefined`（没有现场可留，交给建库那一步自己判断）。
 */
export function quarantineNewsSentimentStorage(
  filePath: string,
  deps: QuarantineNewsSentimentStorageDeps = {}
): string | undefined {
  const copy = deps.copy ?? copyFileSync
  const remove = deps.remove ?? ((path: string) => rmSync(path))
  const target = `${filePath}.corrupt-${(deps.now ?? Date.now)()}`
  const files = ['', '-wal', '-shm']
    .map((suffix) => ({ source: `${filePath}${suffix}`, target: `${target}${suffix}` }))
    .filter((entry) => existsSync(entry.source))
  if (files.length === 0) return undefined
  for (const entry of files) copy(entry.source, entry.target)
  for (const entry of files) remove(entry.source)
  return target
}

/**
 * 读者点「重新抓取所有正文」时用：**先隔离、再建空库**。
 * 隔离抛错时不会走到建库，所以「隔离失败 → 没有新库」是结构保证；建库失败时现场仍在
 * `.corrupt-*` 里，下次还能再来一次。自动路径绝不调用它。
 */
export function rebuildNewsSentimentStorage(
  filePath: string,
  deps: QuarantineNewsSentimentStorageDeps = {}
): { store: NewsSentimentStore; quarantinedCopy?: string } {
  const quarantinedCopy = quarantineNewsSentimentStorage(filePath, deps)
  const store = createNewsSentimentSqliteStore(filePath)
  return quarantinedCopy ? { store, quarantinedCopy } : { store }
}
