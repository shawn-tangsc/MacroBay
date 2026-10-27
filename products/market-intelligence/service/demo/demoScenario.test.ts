import { describe, expect, it } from 'vitest'

import {
  isSampleModeReadMethod,
  isSampleModeWriteMethod,
  parseSampleModeFixture,
  parseSampleModeScenarioMeta,
  sampleModeResponsePath,
  sampleModeScenarioPath
} from './demoScenario'

const meta = {
  schemaVersion: 1,
  id: 'crypto-sample-2026-10',
  title: { 'zh-CN': '十月一周', 'en-US': 'One week in October' },
  scenarioNow: '2026-10-24T20:00:00.000Z',
  window: { from: '2026-10-17T20:00:00.000Z', to: '2026-10-24T20:00:00.000Z' },
  recordedAt: '2026-10-27T09:12:00.000Z',
  sources: ['binance-futures-positioning']
}

describe(' demoScenario 信封', () => {
  it('accepts a well-formed scenario and rejects an id that disagrees with the directory', () => {
    expect(parseSampleModeScenarioMeta(meta, meta.id)?.scenarioNow).toBe(meta.scenarioNow)
    expect(parseSampleModeScenarioMeta(meta, 'other-id')).toBeUndefined()
  })

  it('rejects a window that reaches past the scenario clock', () => {
    const broken = { ...meta, window: { from: meta.window.from, to: '2026-10-25T00:00:00.000Z' } }
    expect(parseSampleModeScenarioMeta(broken, meta.id)).toBeUndefined()
  })

  it('only admits read fixtures, and requires exactly one of payload / byRequest', () => {
    const read = { schemaVersion: 1, method: 'intelligence.queryFundingRateHistory', effect: 'read', payload: { state: 'empty' } }
    expect(parseSampleModeFixture(read, read.method)?.payload).toEqual({ state: 'empty' })
    expect(parseSampleModeFixture({ ...read, effect: 'write' }, read.method)).toBeUndefined()
    expect(parseSampleModeFixture({ ...read, method: 'other.method' }, read.method)).toBeUndefined()
    expect(parseSampleModeFixture({ ...read, byRequest: {} }, read.method)).toBeUndefined()
    expect(parseSampleModeFixture({ schemaVersion: 1, method: read.method, effect: 'read' }, read.method)).toBeUndefined()
  })

  it('keeps byRequest fixtures keyed by the declared request field', () => {
    const fixture = {
      schemaVersion: 1,
      method: 'intelligence.macro.economicCalendar.queryMonth',
      effect: 'read',
      byRequestKey: 'month',
      byRequest: { '2026-10': { state: 'available' } }
    }
    expect(parseSampleModeFixture(fixture, fixture.method)?.byRequestKey).toBe('month')
  })

  it('parses scenario and response paths', () => {
    expect(sampleModeScenarioPath('x/scenarios/s1/scenario.json')).toMatchObject({ scenarioId: 's1', kind: 'meta' })
    expect(sampleModeScenarioPath('x/scenarios/s1/surfaces.json')).toMatchObject({ scenarioId: 's1', kind: 'surfaces' })
    expect(sampleModeResponsePath('x/scenarios/s1/responses/common/a.json')).toMatchObject({ scenarioId: 's1', locale: 'common', name: 'a' })
    expect(sampleModeResponsePath('x/scenarios/s1/responses/zh-CN/a.json')).toMatchObject({ locale: 'zh-CN' })
    expect(sampleModeResponsePath('x/scenarios/s1/other/a.json')).toBeUndefined()
  })

  it('classifies write verbs as writes and query verbs as reads', () => {
    expect(isSampleModeWriteMethod('marketAnalysis.saveSettings')).toBe(true)
    expect(isSampleModeWriteMethod('intelligenceSources.setEnabled')).toBe(true)
    // 租约不是写数据：它必须先被示例数据回答，面板才拿得到快照。
    expect(isSampleModeWriteMethod('intelligence.crossAsset.acquire')).toBe(false)
    expect(isSampleModeWriteMethod('intelligence.queryFearGreedSnapshot')).toBe(false)
    expect(isSampleModeWriteMethod('intelligence.demo.setActive')).toBe(false)
    expect(isSampleModeReadMethod('intelligence.queryFearGreedSnapshot')).toBe(true)
    expect(isSampleModeReadMethod('intelligence.getDetail')).toBe(true)
    expect(isSampleModeReadMethod('intelligenceSources.runNow')).toBe(false)
  })
})
