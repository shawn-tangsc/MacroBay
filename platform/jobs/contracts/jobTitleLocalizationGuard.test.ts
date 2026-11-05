import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 作业名本地化的**计数守卫**（契约 `job-title-localization-contract.md` 阶段 1）。
 *
 * 数的是「注册点里还是字面量的 title」有多少条：`platform/**` 与 `products/**` 里带
 * `audience:` 的作业定义文件，`title: '…'` 或 `title: \`…\`` 都算**未迁移**。
 *
 * **只许减不许增**：基线是今天数出来的真数，不是抄来的估计值。谁新增一条没本地化的作业，
 * 这条会红；谁把一条换成 `{ 'zh-CN': …, 'en-US': … }`，就把基线减一（阶段 3 会降到 0）。
 *
 * 刻意**不把 manifest 的 title 算进来**：`product.manifest.ts` 里的 `title` 是导航名/工具名，
 * 不是 `JobDefinition`，它们早就 `LocalizedText` 了，混进来会让基线虚高。
 */
const BASELINE = 24

const ROOTS = ['platform', 'products']

function jobDefinitionFiles(): string[] {
  const out: string[] = []
  for (const root of ROOTS) {
    for (const file of walk(resolve(root))) {
      if (file.endsWith('.test.ts') || file.includes('/node_modules/')) continue
      const source = readFileSync(file, 'utf8')
      // 只认作业定义文件：定义里一定有 `audience:`
      if (source.includes("audience: '")) out.push(file)
    }
  }
  return out
}

function walk(dir: string): string[] {
  const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs')
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = resolve(dir, entry)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (path.endsWith('.ts')) out.push(path)
  }
  return out
}

function literalTitles(source: string): number {
  const single = source.match(/title:\s*'(?:[^'\\]|\\.)*'/g) ?? []
  const template = source.match(/title:\s*`[^`]*`/g) ?? []
  return single.length + template.length
}

describe('job title localization', () => {
  it('never grows the number of un-localized built-in job titles', () => {
    const byFile = jobDefinitionFiles()
      .map((file) => ({ file, count: literalTitles(readFileSync(file, 'utf8')) }))
      .filter((entry) => entry.count > 0)
    const total = byFile.reduce((sum, entry) => sum + entry.count, 0)

    // 只许减不许增；红的时候把逐文件的计数打出来，一眼能看出是谁新增的。
    expect(total, `${total} un-localized job titles (baseline ${BASELINE}): ${JSON.stringify(byFile, null, 2)}`)
      .toBeLessThanOrEqual(BASELINE)
  })
})
