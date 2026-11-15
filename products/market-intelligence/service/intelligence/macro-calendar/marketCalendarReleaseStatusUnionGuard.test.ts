import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { marketCalendarPublicPolicy } from '../../../contracts/macro/marketCalendarQueryContracts'

/**
 * **六态联合只许有一处定义**（契约里的 `marketCalendarPublicPolicy.releaseStatuses`）。
 *
 * 同一组状态值在别处再写一遍字面量，编译不会报错、运行时却会「这个新状态没人认」而掉进默认分支——
 * 今晚的 `coverage` 闭集已经踩过一次，这里用同形的守卫钉住。
 *
 * 判据：源码里出现「三个以上状态字面量连成数组/联合」的地方，只允许契约那一处。
 */
const PRODUCT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const CONTRACT = 'contracts/macro/marketCalendarQueryContracts.ts'

function productionFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) { productionFiles(full, out); continue }
    if (entry.endsWith('.ts') && !/\.test\.ts$/.test(entry)) out.push(full)
  }
  return out
}

describe('发布状态六态闭集只有一个出处', () => {
  it('闭集本身就是契约里那一份', () => {
    expect([...marketCalendarPublicPolicy.releaseStatuses]).toEqual(
      ['scheduled', 'published', 'cancelled', 'unknown', 'backfilling', 'missing'])
  })

  it('别处不许再写一份状态字面量数组（出现即红）', () => {
    const offenders: string[] = []
    // 只管写/读链路（`service/` 与 `contracts/`）：渲染层那份映射归界面线，等它一并引用契约策略后
    // 再把扫描根加回来——守卫先守最危险的地方，不因为别人的在途文件一直红着。
    const roots = [join(PRODUCT, 'service'), join(PRODUCT, 'contracts')]
    for (const file of roots.flatMap((root) => productionFiles(root))) {
      const rel = relative(PRODUCT, file)
      if (rel === CONTRACT) continue
      const source = readFileSync(file, 'utf8')
      // 一行里出现 3 个以上状态字面量（引号包着），基本就是又抄了一份闭集。
      for (const [index, line] of source.split('\n').entries()) {
        // 只抓「又抄了一份闭集数据」：一行里出现数组/元组字面量 + 3 个以上状态值。
        // 联合类型声明（`type X = 'a' | 'b' | ...`）不算抄件——它没有值，只描述形状。
        if (!/[\[(]/.test(line)) continue
        const hits = ['scheduled', 'published', 'cancelled', 'unknown', 'backfilling', 'missing']
          .filter((status) => line.includes(`'${status}'`)).length
        if (hits >= 3) offenders.push(`${rel}:${index + 1}`)
      }
    }
    expect(offenders, `状态闭集只许在契约里定义，这些位置又写了一遍：\n${offenders.join('\n')}`).toEqual([])
  })
})
