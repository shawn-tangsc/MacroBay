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
// 27 = 迁完 `producers/channelConnectionLost.test.ts` 与 `runtime/notificationNarrowedSurface.test.ts`
// 之后的处数（29 -> 27，正好这两处各减一）。
/**
 * **精确值**，不是上限：写成 `<=` 时，「实际 24、基线 27」会允许回退 3 处——棘轮看着在转，
 * 其实什么都不证明（和「行数常量当验收」同一类毛病）。每迁一处就把这个数字改小一次。
 *
 * 41 = 当前仍传 `policy` 的**调用点数**（不是文件数）。已迁：`notificationRedeliver`、`pushTargetDerivation`、`notificationDedupeCadence`、`notificationNarrowedSurface`、`notificationRuntimeBackoff`、`notificationRuntimeRetention`、`notificationSeverityUpgrade` 各 1 处、`notificationRuntime` 2 处（同形，一笔 -2）。
 */
const BASELINE: number = 25

function callSites(): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'out' || entry === 'dist') continue
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) { walk(path); continue }
      // **测试夹具也要算**：这一批迁移的对象正是夹具。之前沿用生产者门禁的「跳过 .test.」过滤，
      // 导致棘轮一直是空集在比 30——它从写下的那一刻起就没检查过任何东西。
      if (!/\.(ts|tsx|mts)$/u.test(entry)) continue
      const code = readFileSync(path, 'utf8')
      if (/createNotificationEventCatalog\(/u.test(code)) found.push(path)
    }
  }
  walk(join(process.cwd(), 'platform'))
  walk(join(process.cwd(), 'products'))
  return found
}

describe('approval migration ratchet', () => {
  it('passes `policy` in exactly the number of call sites recorded as the baseline', () => {
    // **精确相等**：任何一处回增都当场红，任何一处迁走也要把数字改小——两者都不许漂。
    const occurrences = callSites()
      .map((path) => (readFileSync(path, 'utf8').match(/\bpolicy\s*:/gu) ?? []).length)
      .reduce((sum, count) => sum + count, 0)
    expect(occurrences).toBe(BASELINE)
  })

  it('when the baseline reaches zero, the fallback and the platform table must be gone', () => {
    if (BASELINE !== 0) return
    // 基线到 0：`policy` 参数、平台批准表、这条棘轮都没有存在理由了。留着就是「搬迁做完了还背着兜底」。
    expect(readFileSync(join(process.cwd(), 'platform/notifications/contracts/notificationEventCatalog.ts'), 'utf8')).not.toContain('policy: NotificationEventPolicy')
  })
})
