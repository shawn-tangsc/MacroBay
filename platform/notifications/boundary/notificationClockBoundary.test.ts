import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 「现在」只有一个来源：注入的 `deps.clock`。
 *
 * 这条守卫的由来是一次**自己变红**的用例：`submit()` 里用了 `new Date()`，而测试把日期写死成
 * 某一天，于是它昨天绿、今天零点自己红。修法不是让测试宽容，而是让实现只有一个时钟——
 * 否则「今天」在实现里和测试里是两个不同的值，跨零点必然打架。
 *
 * 两个口子一起禁：无参 `new Date()` 与 `Date.now()` 都读系统时间，只堵一个等于没堵。
 * `new Date(instant)` / `new Date(ms)` 是解析，允许。
 */
const repoRoot = process.cwd()
const runtimeDir = join(repoRoot, 'platform', 'notifications', 'runtime')

function listRuntimeSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) return listRuntimeSources(fullPath)
    if (!/\.ts$/.test(entry.name) || /\.test\.ts$/.test(entry.name)) return []
    return [fullPath]
  })
}

describe('notification clock boundary', () => {
  it('reads the current time only through the injected clock', () => {
    const offenders = listRuntimeSources(runtimeDir).flatMap((filePath) =>
      readFileSync(filePath, 'utf8')
        .split('\n')
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => /new Date\(\s*\)|Date\.now\(\s*\)/.test(line))
        .map(({ line, index }) => `${filePath.slice(repoRoot.length + 1)}:${index + 1}: ${line.trim()}`)
    )

    expect(offenders).toEqual([])
  })
})
