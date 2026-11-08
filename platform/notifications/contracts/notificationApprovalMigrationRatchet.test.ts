import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * **迁移棘轮**（契约 §7.1b）：`createNotificationEventCatalog` 仍传 `policy` 的调用点只许减不许增。
 *
 * 为什么需要它：`policy` 已经降级成兜底，但兜底会变成永久残留——没人记得「还剩几处没迁」。
 * 所以把处数写成基线，每迁一批改小一次；**减到 0 时，这条用例自己要求删参数、删表、删自己**，
 * 终点由代码说，不靠谁记着。静默兜底是这个项目反复踩的坑，这里也一样：数字不降就是在原地。
 */
const BASELINE: number = 30

function callSites(): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'out' || entry === 'dist') continue
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) { walk(path); continue }
      if (!/\.(ts|tsx|mts)$/u.test(entry) || /\.test\.(ts|tsx|mts)$/u.test(entry)) continue
      const code = readFileSync(path, 'utf8')
      if (/createNotificationEventCatalog\(/u.test(code)) found.push(path)
    }
  }
  walk(join(process.cwd(), 'platform'))
  walk(join(process.cwd(), 'products'))
  return found
}

describe('approval migration ratchet', () => {
  it('never grows the number of catalog call sites that still pass `policy`', () => {
    const withPolicy = callSites().filter((path) => /\bpolicy\s*:/u.test(readFileSync(path, 'utf8')))
    // 只许减：基线就是今天的处数。每迁一批把它改小；到 0 时下一句会要求删参数。
    expect(withPolicy.length).toBeLessThanOrEqual(BASELINE)
  })

  it('when the baseline reaches zero, the fallback and the platform table must be gone', () => {
    if (BASELINE !== 0) return
    // 基线到 0：`policy` 参数、平台批准表、这条棘轮都没有存在理由了。留着就是「搬迁做完了还背着兜底」。
    expect(readFileSync(join(process.cwd(), 'platform/notifications/contracts/notificationEventCatalog.ts'), 'utf8')).not.toContain('policy: NotificationEventPolicy')
  })
})
