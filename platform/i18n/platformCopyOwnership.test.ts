import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

import { notificationCopy } from '@platform/i18n/notificationCopy'

import { platformText } from '../../apps/desktop-shell/src/renderer/src/i18n/platformText'

/**
 * 平台文案表只放平台自己的句子。
 *
 * 判据：`platformText` / `notificationCopy` 的每个键必须至少有一个**平台/壳层**消费者；
 * 只被 `products/**` 引用的键，就是产品文案寄存在平台表里 → 红。
 *
 * 两个口径的必要精度：
 * - `notificationCopy` 的键是扁平全串，按字面匹配就够；
 * - `platformText` 靠属性链读（`.leaf`），只有**真的 import 了 platformText 的产品文件**才算
 *   「产品在读这句」——否则产品里任何同名标识符都会误判成消费者。
 *
 * 已知保留项只有一条，带退役条件：
 * `notification.action.open-briefing` —— 平台通知运行时渲染**历史记录**的动作标签要用它；
 * 产品早已改用自己的键（`notification.action.<productId>.*`），所以它不出现在产品源码里
 * （这条断言正是在说「它为什么不算产品专属」）。删它的条件写在文案表注释里：库里
 * `actions[].labelKey === 'notification.action.open-briefing'` 的记录数降到 0（保留期 30 天）。
 */
const ROOT = process.cwd()
const DEFINITION_FILES = [
  'platform/i18n/notificationCopy.ts',
  'apps/desktop-shell/src/renderer/src/i18n/platformText.ts'
]

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'out', 'dist', 'build', 'coverage', '.git'].includes(name)) continue
    const absolute = join(dir, name)
    if (statSync(absolute).isDirectory()) files(absolute, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(absolute)
  }
  return out
}

function sourceOf(roots: readonly string[], options: { skipTests: boolean }): string {
  return roots
    .flatMap((root) => files(join(ROOT, root)))
    .filter((file) => !DEFINITION_FILES.includes(relative(ROOT, file).split('\\').join('/')))
    .filter((file) => !options.skipTests || !/\.test\.(ts|tsx)$/.test(file))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n')
}

function flatten(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix]
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flatten(child, prefix.length === 0 ? key : `${prefix}.${key}`)
  )
}

// 全仓读一次：逐键再读会把这条守卫跑成分钟级。
const PLATFORM_SOURCE = sourceOf(['platform', 'apps/desktop-shell/src'], { skipTests: false })
const PRODUCT_SOURCE = files(join(ROOT, 'products'))
  .filter((file) => !/\.test\.(ts|tsx)$/.test(file))
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n')
const PRODUCT_TEXT_CONSUMERS = files(join(ROOT, 'products'))
  .filter((file) => !/\.test\.(ts|tsx)$/.test(file))
  .map((file) => readFileSync(file, 'utf8'))
  .filter((text) => text.includes("from '@renderer/i18n/platformText'"))
  .join('\n')

/** 键在源码里以字面量出现过（`'k'` / `"k"` / `` `k` ``）。 */
function quotedSomewhere(source: string, key: string): boolean {
  return source.includes(`'${key}'`) || source.includes(`"${key}"`) || source.includes(`\`${key}\``)
}

describe('platform copy carries no product-only sentences', () => {
  it('every notification copy key has a consumer outside products', () => {
    const productOnly = Object.keys(notificationCopy['zh-CN']).filter(
      (key) => !quotedSomewhere(PLATFORM_SOURCE, key) && quotedSomewhere(PRODUCT_SOURCE, key)
    )
    expect(productOnly).toEqual([])
  })

  it('every platform text leaf a product reads is also read by the platform', () => {
    const leaves = [...new Set(flatten(platformText['zh-CN']).map((path) => path.split('.').pop()!))]
    const productOnly = leaves.filter(
      (leaf) => PRODUCT_TEXT_CONSUMERS.includes(`.${leaf}`) && !PLATFORM_SOURCE.includes(`.${leaf}`)
    )
    expect(productOnly).toEqual([])
  })
})
