import { describe, expect, it } from 'vitest'

import { projectSignalAnalysisState, projectSignalAnalysisStates, signalAnalysisStatePolicy } from './signalAnalysisState'

const row = (overrides: Partial<Parameters<typeof projectSignalAnalysisState>[0]['row'] & object> = {}) => ({
  changeHash: 'h', decision: 'queued' as const, reasonCode: 'signal-high-triggered', analysisRunId: null, ...overrides
})

describe('signal analysis state', () => {
  it('reads a skipped row’s own reason, and never invents one', () => {
    const view = projectSignalAnalysisState({ severity: 'high', row: row({ decision: 'skipped', reasonCode: 'fuse-tripped' }), run: undefined })
    expect(view).toMatchObject({ analysisState: 'skipped', analysisReason: 'fuse-tripped' })
  })

  it('is queued until the run answers, published when it succeeded, failed with the run’s code', () => {
    expect(projectSignalAnalysisState({ severity: 'high', row: row({ analysisRunId: 'run-1' }), run: undefined }))
      .toMatchObject({ analysisState: 'queued' })
    expect(projectSignalAnalysisState({ severity: 'high', row: row({ analysisRunId: 'run-1' }), run: { status: 'running', failureCode: null } }))
      .toMatchObject({ analysisState: 'queued' })
    expect(projectSignalAnalysisState({ severity: 'high', row: row({ analysisRunId: 'run-1' }), run: { status: 'succeeded', failureCode: null } }))
      .toMatchObject({ analysisState: 'published' })
    const failed = projectSignalAnalysisState({ severity: 'high', row: row({ analysisRunId: 'run-1' }), run: { status: 'failed', failureCode: 'analysis-upstream-error' } })
    expect(failed).toMatchObject({ analysisState: 'failed', analysisReason: 'analysis-upstream-error' })
    // 校验没过、被取消都算「跑了没成」，不是「没跑」。
    expect(projectSignalAnalysisState({ severity: 'high', row: row({ analysisRunId: 'run-1' }), run: { status: 'cancelled', failureCode: null } }))
      .toMatchObject({ analysisState: 'failed' })
  })

  it('turns a low mark with no row into skipped, not into a wait that will never end', () => {
    const view = projectSignalAnalysisState({ severity: 'low', row: undefined, run: undefined })
    expect(view).toMatchObject({ analysisState: 'skipped', analysisReason: signalAnalysisStatePolicy.lowSeverityReason })
    // 同一张表里，高档没行才是「还没轮到」。
    expect(projectSignalAnalysisState({ severity: 'high', row: undefined, run: undefined }))
      .toMatchObject({ analysisState: 'not-triggered' })
  })

  it('projects a screenful in one pass, keyed by change hash, beside the signals', () => {
    const states = projectSignalAnalysisStates({
      changeHashes: ['h-ok', 'h-failed', 'h-low', 'h-none'],
      rows: [
        { changeHash: 'h-ok', decision: 'queued', reasonCode: 'signal-high-triggered', analysisRunId: 'run-1' },
        { changeHash: 'h-failed', decision: 'queued', reasonCode: 'signal-high-triggered', analysisRunId: 'run-2' }
      ],
      runs: {
        'run-1': { status: 'succeeded', failureCode: null },
        'run-2': { status: 'failed', failureCode: 'analysis-provider-error' }
      },
      severities: { 'h-ok': 'high', 'h-failed': 'high', 'h-low': 'low', 'h-none': 'medium' }
    })
    expect(states['h-ok']).toMatchObject({ analysisState: 'published' })
    expect(states['h-failed']).toMatchObject({ analysisState: 'failed', analysisReason: 'analysis-provider-error' })
    // 低档没有行也必须是 skipped：等着一条永远不会来的分析，比直接说「这条不够格」坏。
    expect(states['h-low']).toMatchObject({ analysisState: 'skipped' })
    expect(states['h-none']).toMatchObject({ analysisState: 'not-triggered' })
  })

  it('answers the reader’s own switch without reading it out of the ledger', () => {
    // 账本整段清空时，读者关掉的那一项仍然必须是「关掉了」，不能因为查不到行就变假。
    expect(projectSignalAnalysisState({ severity: 'high', row: undefined, run: undefined, analysisOffByReader: true }))
      .toMatchObject({ analysisOffByReader: true })
  })

  it('has no “capability not shipped” field left: it would be a constant', () => {
    // 扫描接上之后「分析还没上线」永远不会出现。恒真的字段就是永不出现的那句文案，删掉它，
    // 也删掉那句文案——不留占位，不写「将来可能有用」。
    expect(Object.keys(projectSignalAnalysisState({ severity: 'high', row: undefined, run: undefined })))
      .toEqual(['analysisOffByReader', 'analysisState'])
  })
})
