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
    // 有运行 id 但取不到运行行：那是「跑过、记录过期」，不是还在排队——说成排队，读者会一直等。
    expect(projectSignalAnalysisState({ severity: 'high', row: row({ analysisRunId: 'run-1' }), run: undefined }))
      .toMatchObject({ analysisState: 'stopped', analysisReason: 'run-expired' })
    // 还没有运行 id：确实还没排上队。
    expect(projectSignalAnalysisState({ severity: 'high', row: row({ analysisRunId: null }), run: undefined }))
      .toMatchObject({ analysisState: 'queued' })
    expect(projectSignalAnalysisState({ severity: 'high', row: row({ analysisRunId: 'run-1' }), run: { status: 'running', failureCode: null } }))
      .toMatchObject({ analysisState: 'queued' })
    expect(projectSignalAnalysisState({ severity: 'high', row: row({ analysisRunId: 'run-1' }), run: { status: 'succeeded', failureCode: null } }))
      .toMatchObject({ analysisState: 'published' })
    const failed = projectSignalAnalysisState({ severity: 'high', row: row({ analysisRunId: 'run-1' }), run: { status: 'failed', failureCode: 'analysis-upstream-error' } })
    expect(failed).toMatchObject({ analysisState: 'failed', analysisReason: 'analysis-upstream-error' })
    expect(projectSignalAnalysisState({ severity: 'high', row: row({ analysisRunId: 'run-1' }), run: { status: 'invalid-output', failureCode: 'analysis-invalid-json' } }))
      .toMatchObject({ analysisState: 'failed', analysisReason: 'analysis-invalid-json' })
  })

  it('says a stopped run was stopped, with its own reason, never “failed”', () => {
    const stopped = (status: string) => projectSignalAnalysisState({ severity: 'high', row: row({ analysisRunId: 'run-1' }), run: { status, failureCode: null } })
    // 读者自己关窗、或它被新的一次取代：都不是「它坏了」。
    expect(stopped('cancelled')).toMatchObject({ analysisState: 'stopped', analysisReason: 'run-cancelled' })
    expect(stopped('stale')).toMatchObject({ analysisState: 'stopped', analysisReason: 'run-superseded' })
    expect(stopped('superseded')).toMatchObject({ analysisState: 'stopped', analysisReason: 'run-superseded' })
    // 认不出的状态：既不诬告成「没成」，也不谎报成「在等」，而且必须留下缺陷标记。
    expect(stopped('some-future-status')).toMatchObject({ analysisState: 'stopped', analysisReason: 'run-unrecognized' })
    expect(stopped('cancelled').analysisState).not.toBe('failed')
    expect(stopped('cancelled').analysisState).not.toBe('not-triggered')
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
      signals: [
        { changeHash: 'h-ok', severity: 'high' }, { changeHash: 'h-failed', severity: 'high' },
        { changeHash: 'h-low', severity: 'low' }, { changeHash: 'h-none', severity: 'medium' }
      ],
      rows: [
        { changeHash: 'h-ok', decision: 'queued', reasonCode: 'signal-high-triggered', analysisRunId: 'run-1' },
        { changeHash: 'h-failed', decision: 'queued', reasonCode: 'signal-high-triggered', analysisRunId: 'run-2' }
      ],
      runs: {
        'run-1': { status: 'succeeded', failureCode: null },
        'run-2': { status: 'failed', failureCode: 'analysis-provider-error' }
      },
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
