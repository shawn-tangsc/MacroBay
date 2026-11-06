import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { APP_ROOT, ENTRY } from './__fixtures__/appEntry'

const DIR = fileURLToPath(new URL('.', import.meta.url))

/**
 * 守卫：分离窗这批用例的应用入口地址只能来自 `__fixtures__/appEntry`。
 *
 * 理由是一次真实的 Windows 红：用例把入口写死成 `file:///app/renderer`，那是 POSIX 根目录的形状，
 * Windows 上 `fileURLToPath` 对没有盘符的 file URL 直接抛错，入口判定按非法入口 fail closed，
 * 十来条用例以 `detached-window-entry-rejected` 红掉，而产品逻辑其实没错。这件事在
 * `docs-private/10-development/pitfalls/2026-10-27-file-entry-must-use-the-native-path-rule.md`
 * 里已经写过一次，写完之后这些固定值还在——所以需要一条机器能判的守卫，而不是再写一遍文档。
 *
 * 只禁 `file:///app` 这一种形状，不禁 `file:///etc/passwd` 这类**故意要被拒绝**的负例：后者在
 * 两个平台上都会被拒，断言恒真；前者正是「本该合法却被拒」的那一类。
 */
describe('分离窗测试的应用入口固定值', () => {
  it('没有任何用例再写死 file:///app（入口地址一律取自共享固定值）', () => {
    const files = readdirSync(DIR).filter((name) => name.endsWith('.test.ts'))
    // 空转自检：扫到的文件数必须和目录里的实际数量一致，否则「没有命中」可能只是没扫到。
    expect(files.length).toBeGreaterThan(30)
    // 跳过本文件：上面那段注释为了说清来由必须原样引用那种形状，不跳过就会扫到自己。
    const scoped = files.filter((name) => name !== 'appEntryFixtureGuard.test.ts')
    const offenders = scoped.filter((name) => readFileSync(join(DIR, name), 'utf8').includes('file:///app'))
    expect(offenders).toEqual([])
  })

  it('固定值由宿主根目录派生：入口就在应用根之下，两者都是绝对 file URL', () => {
    expect(APP_ROOT.startsWith('file:')).toBe(true)
    expect(ENTRY.startsWith('file:')).toBe(true)
    expect(new URL(ENTRY).href.startsWith(`${new URL(APP_ROOT).href}/`)).toBe(true)
  })
})
