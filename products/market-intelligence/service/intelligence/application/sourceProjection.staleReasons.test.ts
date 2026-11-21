import { describe, expect, it } from 'vitest'

import { allSources } from './providerRegistry'
import { settingsView } from './sourceProjection'

/**
 * 采集**产出**状态在来源投影里的位置（2026-11-21 新闻静默事故）。
 *
 * 与 `healthState` 并列、**绝不并进去**：事故那两天每个采集任务都是成功的，`healthState` 全是绿，
 * 而新闻两天没有新条目。把这两个状态折进健康五态，读者会去查网络与凭据；真相是「源不发了」或
 * 「我们的解析坏了」。两个原因可能同时为真，投影必须原样两个都带出去，不在这一层挑。
 */
const newsSourceId = 'coindesk-rss'

function viewOf(view: ReturnType<typeof settingsView>) {
  return view.groups
    .flatMap((group) => group.providers)
    .flatMap((provider) => provider.sources)
    .find((source) => source.sourceId === newsSourceId)!
}

type StaleById = NonNullable<NonNullable<Parameters<typeof settingsView>[0]>['staleById']>

function stateWith(staleById?: StaleById) {
  return {
    enabledById: { [newsSourceId]: true },
    healthById: { [newsSourceId]: { runtimeStatus: 'healthy' as const, consecutiveFailures: 0 } },
    jobRegisteredById: {},
    knownSourceIds: new Set([newsSourceId]),
    ...(staleById === undefined ? {} : { staleById })
  }
}

describe('采集产出状态在来源投影里的位置', () => {
  it('采集是绿的、但没有产出：staleReasons 在，healthState 仍是 healthy', () => {
    const view = viewOf(settingsView(stateWith({
      [newsSourceId]: { staleReasons: ['no-output'], staleMeasurements: { noOutputHours: 30 } }
    }) as never))
    expect(view.staleReasons).toEqual(['no-output'])
    expect(view.staleMeasurements).toEqual({ noOutputHours: 30 })
    // 关键：产出问题没有把来源标成故障，也没有把它从绿染黄。
    expect(view.healthState).toBe('healthy')
  })

  it('两种病同时为真：两条原因原样带出，不在这里挑一个', () => {
    const view = viewOf(settingsView(stateWith({
      [newsSourceId]: {
        staleReasons: ['no-output', 'normalize-failing'],
        staleMeasurements: { noOutputHours: 30, normalizeFailureStreak: 3 }
      }
    }) as never))
    expect(view.staleReasons).toEqual(['no-output', 'normalize-failing'])
  })

  it('没有可报的病时不带这两个键（不是空数组、不是空对象）', () => {
    const view = viewOf(settingsView(stateWith() as never))
    expect('staleReasons' in view).toBe(false)
    expect('staleMeasurements' in view).toBe(false)
  })

  it('产出状态与健康读数同时存在时互不影响：健康折成 failed 也不改原因的措辞', () => {
    const view = viewOf(settingsView({
      ...stateWith({ [newsSourceId]: { staleReasons: ['normalize-failing'], staleMeasurements: { normalizeFailureStreak: 4 } } }),
      healthById: { [newsSourceId]: { runtimeStatus: 'failed' as const, consecutiveFailures: 4 } }
    } as never))
    expect(view.healthState).toBe('failed')
    // 两件事各说各的：原因列表不因为健康已经红了就被清掉。
    expect(view.staleReasons).toEqual(['normalize-failing'])
  })
})