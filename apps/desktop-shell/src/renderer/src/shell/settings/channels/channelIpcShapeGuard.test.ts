import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 通道设置页的「跨进程返回值不许手写形状」守卫。
 *
 * 为什么需要它：`ipcRenderer.invoke` 的类型是 `Promise<any>`，所以渲染层写
 * `const created = await channels.create(...) as { id: string }` 时，**typecheck 不会红**，
 * 而真实返回是 `{ ok, code, channel: { id } }`。2026-11-04 的事故就是它：界面拿不到 id →
 * 报「操作失败，请重试」→ 用户再点 → 库里堆了 8 条重复频道。
 *
 * 规则：本目录里的**非测试**源码，不许出现 `as {`（把跨进程返回值宣布成某种形状）。
 * 真实类型由 preload 方法声明提供；需要窄化时写窄化函数，不写断言。
 *
 * 与实现同一笔落地：读侧类型覆盖（`f4c49c1`）与本目录 cast 清零之后再进树，
 * 所以它进来时天然是绿的。改动本守卫时先跑第一条夹具——那条必须红。
 */

const DIR = resolve(__dirname)

/** 纯函数：给一段源码，返回违规行号（1 基）。夹具直接测它。 */
export function scanSource(source: string): number[] {
  const hits: number[] = []
  commentLines(source).forEach((line, index) => {
    // 只认「断言成对象形状」：`as {`（含换行前的写法）。`as const` / `as Catalog[]` 不在此列。
    if (/\bas\s*\{/.test(line)) hits.push(index + 1)
  })
  return hits
}

/**
 * 把注释行换成空行（保持行号不变）：注释里写一句「别写 as {…}」不该让守卫红，
 * 行号仍要能指回真实代码——这是「扫描器先剥注释」的同一课，今晚已经被糊过一次。
 */
function commentLines(source: string): string[] {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (text) => text.replace(/[^\n]/g, ''))
  return withoutBlocks.split('\n').map((line) => (line.trimStart().startsWith('//') ? '' : line))
}

function scanDirectory(): Array<{ file: string; line: number }> {
  const found: Array<{ file: string; line: number }> = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.(ts|tsx)$/.test(entry) || entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) continue
      for (const line of scanSource(readFileSync(full, 'utf8'))) {
        found.push({ file: relative(process.cwd(), full), line })
      }
    }
  }
  walk(DIR)
  return found
}

describe('channel settings: no hand-written shapes for cross-process values', () => {
  it('detects the exact shape that caused the duplicate channels (fixture must go red)', () => {
    const bad = [
      'const created = (await window.platform.channels.create({ type })) as { id?: string } | undefined'
    ].join('\n')
    expect(scanSource(bad)).toEqual([1])
  })

  it('does not flag a comment that merely mentions the forbidden form', () => {
    // 注释里写着「这里不写 as {…}」是解释，不是违规；扫描器先剥注释，行号仍指向真实代码。
    const commented = [
      '// 这里不写 as { … }：形状由 preload 声明给',
      'const created = await window.platform.channels.create({ type })'
    ].join('\n')
    expect(scanSource(commented)).toEqual([])
  })

  it('does not flag narrowing that is not an object assertion', () => {
    const ok = [
      'const catalog = (await window.platform.channels.catalog()) as Catalog[]',
      'const mode = value as ChannelPermissionMode',
      'const frozen = { type: "system" } as const'
    ].join('\n')
    expect(scanSource(ok)).toEqual([])
  })

  it('no file in the channel settings dir asserts an object shape', () => {
    expect(scanDirectory()).toEqual([])
  })
})
