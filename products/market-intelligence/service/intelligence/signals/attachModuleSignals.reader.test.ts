import { describe, expect, it } from 'vitest'

import { attachModuleSignals } from './attachModuleSignals'

/**
 * 读口的两种状态，都是装配层的事：
 * 挂上了，状态跟着信号一起出来；没挂上，整次读取按「版本对不上」处理——**不许**报成
 * 「读到了，只是没有状态」，那样卡片会把我们的漏接线说成读者的今天很安静。
 */
function host() {
  const into = {
    queryOpenInterestHistory: async () => ({ state: 'unavailable' as const, failureCode: 'x' }),
    queryCapitalConditionsSnapshot: async () => ({ state: 'unavailable' as const, failureCode: 'x' }),
    queryMacroRoute: async () => ({ provider: [] }),
    normalizeMacroRouteMonths: () => [],
    addSignalAnalysisReader: () => undefined,
    queryModuleSignalRead: async () => ({ state: 'available' as const, signals: [], analysis: {}, droppedInvalid: 0 })
  }
  return into as unknown as Parameters<typeof attachModuleSignals>[0]
}

describe('the analysis read mounted at assembly', () => {
  it('answers with the states when the reader is mounted', async () => {
    const target = host()
    attachModuleSignals(target)
    target.addSignalAnalysisReader({
      rows: () => [{ changeHash: 'h-1', decision: 'queued', reasonCode: 'x', analysisRunId: 'mi-ar-1' }],
      runs: () => ({ 'mi-ar-1': { status: 'succeeded', failureCode: null } }),
      analysisOffByReader: () => false
    })
    // 读到的是一次可用结果（信号可能为空，也可能带着 unavailable 的腿），状态块跟着一起来。
    const read = await target.queryModuleSignalRead({ asOf: '2026-11-06T10:30:00.000Z' })
    expect(read.state).toBe('available')
    expect(read).toHaveProperty('analysis')
  })

  it('reports a missing reader as a mismatch, never as "read fine, nothing to show"', async () => {
    const target = host()
    attachModuleSignals(target)
    // 没挂读口（装配漏了、或跑的是旧进程）：这次读取整块不可用，卡片才有资格出那个红色感叹号。
    await expect(target.queryModuleSignalRead({ asOf: '2026-11-06T10:30:00.000Z' }))
      .resolves.toEqual({ state: 'unavailable', failureCode: 'contract-invalid' })
  })
})
