import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { NOTIFICATION_EVENT_POLICY } from '../contracts/notificationEventPolicy'
import { DORMANT_NOTIFICATION_EVENTS } from '../contracts/notificationDormantEvents'

/**
 * 生产者门禁（契约 v2.29 §12.1）。
 *
 * 为什么需要它：今晚有**四条**事件是「登记了、批准了、没有一行代码提交它」——额度用尽、
 * 凭据失效、凭据恢复、桌面没弹出来。每条都有声明、有文案、有批准档位，看起来齐备，
 * 实际永远不会响。这种缺陷不看代码查不出来，只能机械地守。
 *
 * 判定口径（宁可报「无法判定」，也不许悄悄漏过）：
 * 1. 每条批准表事件，必须在**非测试**源码里有一处提交入口（`submit(` / `submitNotification(` 等），
 *    且该文件里出现这条事件的 id —— 字面量，或指向它的字符串常量 / 常量表属性。
 * 2. 或者显式登记在 `DORMANT_NOTIFICATION_EVENTS` 里，写清认领人、原因、复活条件。
 * 3. 两者都没有 → 红，并点名事件 id。
 *
 * 为什么不用「只认字面量」：仓库里几乎没人写字面量，都走常量；只认字面量的守卫会全漏，
 * 今晚已经出现过一次「守卫只能抓到不推荐的写法」。
 */
const repoRoot = process.cwd()
const sourceRoots = ['platform', join('apps', 'desktop-shell', 'src'), 'products']

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) return listSourceFiles(fullPath)
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) return []
    return [fullPath]
  })
}

function relativePath(filePath: string): string {
  return filePath.slice(repoRoot.length + 1)
}

const sources = sourceRoots
  .flatMap((root) => {
    try {
      return listSourceFiles(join(repoRoot, root))
    } catch {
      return []
    }
  })
  .map((filePath) => ({ path: relativePath(filePath), text: readFileSync(filePath, 'utf8') }))

type FileFacts = {
  path: string
  hasSubmit: boolean
  quotedIds: Set<string>
  identifiers: Set<string>
}

/**
 * 每个文件只扫一遍，把「有没有提交入口 / 出现哪些字符串 id / 出现哪些标识符」记下来。
 * 逐事件去扫全仓会让这条守卫跑八秒（今晚实测超时），而它要跑在每次提交前。
 */
const fileFacts: FileFacts[] = sources.map((source) => ({
  path: source.path,
  hasSubmit: /\bsubmit[A-Za-z]*\s*\(/.test(source.text),
  quotedIds: new Set([...source.text.matchAll(/'([a-z0-9][a-z0-9.-]*)'/g)].map((match) => match[1])),
  identifiers: new Set(
    [...source.text.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g)].map((match) => match[1])
  )
}))

/**
 * 指向某个事件 id 的标识符，两种写法都要认：
 * - 字符串常量：`const X = 'id'`
 * - 常量表属性：`signalTriggered: 'market-intelligence.signal.triggered'`（使用处写 `EVENT_IDS.signalTriggered`）
 */
function aliasesFor(eventId: string): { names: string[]; properties: string[] } {
  const names = new Set<string>()
  const properties = new Set<string>()
  const escaped = eventId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const constantPattern = new RegExp(
    `(?:const|let)\\s+([A-Za-z0-9_]+)\\s*(?::\\s*[^=]+)?=\\s*'${escaped}'`,
    'g'
  )
  const propertyPattern = new RegExp(`([A-Za-z0-9_]+)\\s*:\\s*'${escaped}'`, 'g')
  for (const source of sources) {
    if (!source.text.includes(eventId)) continue
    for (const match of source.text.matchAll(constantPattern)) names.add(match[1])
    for (const match of source.text.matchAll(propertyPattern)) properties.add(match[1])
  }
  return { names: [...names], properties: [...properties] }
}

export function producerFilesFor(eventId: string): string[] {
  const aliases = aliasesFor(eventId)
  return fileFacts
    .filter((file) => {
      if (!file.hasSubmit) return false
      if (file.quotedIds.has(eventId)) return true
      if (aliases.names.some((name) => file.identifiers.has(name))) return true
      return aliases.properties.some((property) => file.identifiers.has(property))
    })
    .map((file) => file.path)
}

describe('notification producer coverage (契约 §12.1)', () => {
  it('every approved event has a submit call site, or is explicitly dormant', { timeout: 30_000 }, () => {
    const uncovered: string[] = []
    for (const id of Object.keys(NOTIFICATION_EVENT_POLICY)) {
      if (DORMANT_NOTIFICATION_EVENTS[id] !== undefined) continue
      if (producerFilesFor(id).length === 0) uncovered.push(id)
    }
    expect(uncovered).toEqual([])
  })

  it('dormant entries answer all three questions instead of a bare true', () => {
    for (const [id, entry] of Object.entries(DORMANT_NOTIFICATION_EVENTS)) {
      expect(entry.owner.trim().length, `${id} 必须写认领人`).toBeGreaterThan(0)
      expect(entry.reason.trim().length, `${id} 必须写为什么现在不发`).toBeGreaterThan(0)
      expect(entry.reviveWhen.trim().length, `${id} 必须写复活条件`).toBeGreaterThan(0)
      // 休眠的条目也不该同时有生产者：两边都写，说明状态本身没想清。
      expect(producerFilesFor(id), `${id} 已休眠却仍有提交点`).toEqual([])
    }
  })

  it('reports an event whose only reference is its declaration', () => {
    // 夹具：批准表里若有、却没有任何提交点的 id，判定必须返回空——这条保护的是
    // 「门禁真的会红」，不是某一条具体事件。
    expect(producerFilesFor('platform.this-event-has-no-producer')).toEqual([])
  })
})
