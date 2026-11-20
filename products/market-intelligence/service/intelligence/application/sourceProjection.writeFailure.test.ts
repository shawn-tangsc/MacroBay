import { describe, expect, it } from 'vitest'

import { allSources } from './providerRegistry'
import { settingsView } from './sourceProjection'

/**
 * 标准表**写库失败**在投影里的位置（用户 2026-11-19 定，`f817070` 提供数据）：
 *
 * **与 `healthState` 并列，绝不并进去。** 写库失败不是来源失败——要是把它算成 `failed`，读者会去
 * 查网络与凭据，而真相是我们的库写不进去；这两句话对应的动作完全不同。
 *
 * 另一条要钉住的：**「这一期有值」不许被当作「这个源健康」的证据**。旧值照显是允许的，
 * 所以 `writeFailure` 存在时 `healthState` 仍可以是 `healthy`——两者各说各的事，不能互相顶替。
 */
const routerSourceId = 'macro-calendar-0xrouter-economic-data'

function viewOf(router: ReturnType<typeof settingsView>) {
  return router.groups
    .flatMap((group) => group.providers)
    .flatMap((provider) => provider.sources)
    .find((source) => source.sourceId === routerSourceId)!
}

describe('标准表写库失败在来源投影里的位置', () => {
  it('写库失败时：writeFailure 在、healthState 仍是 healthy——两者并列，不互相顶替', () => {
    const definition = allSources().find((source) => source.sourceId === routerSourceId)!
    const view = viewOf(settingsView({
      enabledById: { [routerSourceId]: true },
      healthById: { [routerSourceId]: { runtimeStatus: 'healthy', consecutiveFailures: 0 } },
      jobRegisteredById: {},
      knownSourceIds: new Set([routerSourceId]),
      writeFailureById: {
        [routerSourceId]: { at: '2026-11-19T12:00:00.000Z', code: 'standard-write-failed' }
      }
    }) as never)
    expect(definition).toBeTruthy()
    expect(view.writeFailure).toEqual({ at: '2026-11-19T12:00:00.000Z', code: 'standard-write-failed' })
    // 关键：写库失败没有把来源标成故障。
    expect(view.healthState).toBe('healthy')
  })

  it('没有失败时不带这个键（不是空对象、不是 null）', () => {
    const view = viewOf(settingsView({
      enabledById: { [routerSourceId]: true },
      healthById: { [routerSourceId]: { runtimeStatus: 'healthy', consecutiveFailures: 0 } },
      jobRegisteredById: {},
      knownSourceIds: new Set([routerSourceId])
    }) as never)
    expect('writeFailure' in view).toBe(false)
    expect(view.healthState).toBe('healthy')
  })

  it('读不到健康读数时也不会因为缺 writeFailure 就编一个：两件各自缺席', () => {
    const view = viewOf(settingsView({
      enabledById: { [routerSourceId]: true },
      healthById: {},
      jobRegisteredById: {},
      knownSourceIds: new Set([routerSourceId])
    }) as never)
    expect('writeFailure' in view).toBe(false)
    // 没有健康读数不是「健康」（既有口径），也不是「写库失败」。
    expect(view.healthState).toBe('off')
  })
})
