import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 产品代码里**零处**手拼落库键（契约 v2.32 / 验收 N22 ④）。
 *
 * 键（模板串、`产品id|` 前缀、分隔符、展开时机）只在平台的声明与落库一处生成。产品这边一旦
 * 自己拼，拼错时平台只会回「记录不存在」，读者看到的就是一句和真实原因无关的话——2026-11-05
 * 那个「这一版还没进通知」就是这么来的。所以这条守卫扫的是**产品源码**：出现即失败。
 *
 * 测试文件不在扫描范围：用例断言的正是「平台落库后的键长什么样」，那是被观察的事实，不是产品在拼它。
 */

const PRODUCT_ROOT = __dirname
const FORBIDDEN = 'market-intelligence|'
const SKIP_DIRS = new Set(['node_modules', 'fixtures', '__fixtures__'])

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return SKIP_DIRS.has(entry.name) ? [] : sourceFiles(join(directory, entry.name))
    }
    if (!entry.isFile() || !/\.(ts|tsx)$/u.test(entry.name)) return []
    // 用例与被观察的夹具不算产品代码：它们要写键，才能断言平台拼出来的键。
    return entry.name.includes('.test.') ? [] : [join(directory, entry.name)]
  })
}

describe('notification keys are platform-built only', () => {
  it('no product source file builds a stored notification key by hand', () => {
    const offenders = sourceFiles(PRODUCT_ROOT)
      .filter((path) => readFileSync(path, 'utf8').includes(FORBIDDEN))
      .map((path) => path.slice(PRODUCT_ROOT.length + 1))

    // 空数组才通过；有名字时，每个名字就是一处「下一个产品会照着抄」的样例。
    expect(offenders).toEqual([])
  })
})
