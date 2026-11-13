import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 守卫：**查询/读取层不许按源名写分支**。
 *
 * 日历对源不感知——读者看到的行不该因为「这条来自 narwhal 还是 0xrouter」而走不同逻辑。
 * 允许出现源名的地方只有两类：采集适配（每个源自己的目录/摄取器）与注册表。
 * 但「允许出现」不等于「随便加」：新增一处源名字面量，就得在这里登记一次，改动可审。
 *
 * **基线文件与本用例同一笔提交**：不带基线等于上一个出生即红的门禁。
 * 反向自证：往查询层临时写 `if (sourceId === 'narwhal')` → 本用例红。
 */
const ROOT = new URL('./', import.meta.url).pathname
const PATTERN = /'0xrouter'|'narwhal'/g

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__baselines__') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) { out.push(...tsFiles(full)); continue }
    if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full)
  }
  return out
}

describe('源名字面量守卫', () => {
  it('新增一处源名分支必须同时更新基线（否则这里红）', () => {
    const baseline = JSON.parse(readFileSync(join(ROOT, '__baselines__/source-literals.json'), 'utf8')) as Record<string, number>
    const current: Record<string, number> = {}
    for (const file of tsFiles(ROOT)) {
      const relative = file.slice(ROOT.length)
      const hits = readFileSync(file, 'utf8').match(PATTERN)
      if (hits) current[relative] = hits.length
    }
    // 只看「新增」：某个文件比基线多一处 → 红；变少（清理）不拦，但也提醒更新基线。
    const growth = Object.entries(current)
      .filter(([file, count]) => count > (baseline[file] ?? 0))
      .map(([file, count]) => `${file}: ${baseline[file] ?? 0} → ${count}`)
    expect(growth, `源名字面量新增，必须在 __baselines__/source-literals.json 里登记：\n${growth.join('\n')}`)
      .toEqual([])
  })
})
