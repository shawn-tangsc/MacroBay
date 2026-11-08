import { describe, expect, it } from 'vitest'

import { projectJobRegistration, sourceJobIds } from './sourceJobRegistration'

const source = (sourceId: string, kind = 'official-calendar', collection = 'provider') => ({ sourceId, kind, collection })

/**
 * 「这个源有没有自动任务」只认 `listSchedules()`。
 *
 * 旧的实现还有一条兜底：`已启用 && 需要作业` 就算「已注册」。于是 BLS 按决定停掉自动同步之后，
 * 设置页依然显示「已注册自动任务」——正好是那条硬规矩禁掉的「从开关反推状态」。
 */
describe('projectJobRegistration', () => {
  it('reports not-scheduled for an enabled source whose definition is absent', () => {
    const result = projectJobRegistration([source('macro-calendar-bls')], new Set(['some-other-job']))
    expect(result).toEqual({ 'macro-calendar-bls': false })
  })

  it('reports scheduled only when the runtime really holds its definition', () => {
    expect(projectJobRegistration([source('macro-calendar-bls')], new Set(['market-intelligence.syncBlsScheduleAndValues.automatic'])))
      .toEqual({ 'macro-calendar-bls': true })
  })

  it('knows the BLS sync job is the definition that owns that source', () => {
    expect(sourceJobIds(source('macro-calendar-bls'))).toContain('market-intelligence.syncBlsScheduleAndValues.automatic')
  })
})
