import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * 崩溃收尾只在 **boot 那一趟**跑一次。
 *
 * 这条守卫挡的是「把它挪到每次读会话都跑」——那样一条老消息会在别人跑到一半时被收掉
 * （台账 35 的原始卡点）。所以判据不是「文件里出现过这个词」，而是：
 * ① `app.ts` 里只有一个调用点；② 它不在任何 IPC 处理器里。
 */
describe('startup convergence runs once, at boot', () => {
  const appSource = readFileSync(new URL('./app.ts', import.meta.url), 'utf8')

  it('has exactly one call site, inside the boot sequence', () => {
    const occurrences = appSource.match(/\breconcileStalePendingMessages\(/gu) ?? []
    // 一处调用 + 一处 import 的具名引用不算调用（import 行没有左括号）。
    expect(occurrences).toHaveLength(1)
    const callIndex = appSource.indexOf('reconcileStalePendingMessages(')
    const bootIndex = appSource.indexOf('export async function bootstrapDesktopApp')
    expect(callIndex).toBeGreaterThan(bootIndex)
  })

  it('is not reachable from an IPC handler', () => {
    const handler = readFileSync(new URL('./agentIpcHandlers.ts', import.meta.url), 'utf8')
    expect(handler).not.toContain('reconcileStalePendingMessages')
  })
})
