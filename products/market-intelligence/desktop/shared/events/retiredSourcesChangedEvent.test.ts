// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 退役的旧来源通道 `market-intelligence:sources-changed` **不许再出现**。
 *
 * 它已被设置域信号（`subscribeSettingsRevision('sources', …)`）取代，模块在 `e760fbd` 删掉。
 * 原来这里是一条行为用例（「派发旧事件 → 读口不重读」），模块一删它就**永远绿**：没人能发那个
 * 事件，等于在测一件不可能发生的事。改成静态守卫——**全仓代码里不许再出现这个名字**，
 * 这样「有人把它加回来」才会红。
 *
 * 两条口径：
 * 1. **先剥注释再扫**：注释里写「旧通道已退役」是应该的，不许因此红（与通知门禁的教训同一条：
 *    两次假通过都是被注释里的示例骗过去的）；
 * 2. 扫描集是产品、平台桌面层与壳层（`products` / `platform/desktop` / `apps/desktop-shell`）的
 *    `*.ts` / `*.tsx`，测试文件也在内——用例里派发旧事件同样是把它加了回来。
 *
 * 这是**棘轮**：它证明「名字不在树里」，不证明「行为对」；行为那一半由设置域信号的用例负责。
 */
const ROOT = process.cwd()
const SCANNED_ROOTS = ['products', 'platform/desktop', 'apps/desktop-shell'] as const
const SKIPPED = new Set(['node_modules', 'out', 'dist', '.git', 'generated'])
const CODE_FILE = /\.(ts|tsx)$/

/** 分两半拼，守卫文件自己不命中自己。 */
const RETIRED_NEEDLES = [
  ['market-intelligence', 'sources-changed'].join(':'),
  ['INTELLIGENCE', 'SOURCES_CHANGED_EVENT'].join('_'),
  ['notify', 'IntelligenceSourcesChanged'].join('')
] as const

function codeFilesIn(directory: string): string[] {
  const files: string[] = []
  let entries
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch {
    return files
  }
  for (const entry of entries) {
    if (SKIPPED.has(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...codeFilesIn(path))
    else if (CODE_FILE.test(entry.name)) files.push(path)
  }
  return files
}

/** 去掉块注释与行注释；`https://` 这种「冒号后两条斜杠」不算注释起点。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

describe('the retired sources-changed channel stays dead', () => {
  it('does not appear anywhere in product, platform-desktop or shell code', () => {
    const hits: string[] = []
    for (const root of SCANNED_ROOTS) {
      for (const file of codeFilesIn(resolve(ROOT, root))) {
        const code = stripComments(readFileSync(file, 'utf8'))
        for (const line of code.split('\n')) {
          if (RETIRED_NEEDLES.some(needle => line.includes(needle))) {
            hits.push(`${relative(ROOT, file)}: ${line.trim()}`)
            break
          }
        }
      }
    }

    expect(hits).toHaveLength(0)
    expect(hits).toEqual([])
  })
})
