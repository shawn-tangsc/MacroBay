import { describe, expect, it, vi } from 'vitest'

import { mountSignalAnalysisReader } from './mountSignalAnalysisReader'

describe('mounting the analysis reader', () => {
  it('mounts all three reads, so the cards have a state to show', async () => {
    const addReader = vi.fn()
    const listLatestSignalLedgerStates = vi.fn(() => [{ changeHash: 'h-1', decision: 'queued' as const, reasonCode: 'x', analysisRunId: 'mi-ar-1' }])
    const getRunsByIds = vi.fn(() => ({ 'mi-ar-1': { status: 'succeeded', failureCode: null } }))
    mountSignalAnalysisReader({ addReader, repository: { listLatestSignalLedgerStates, getRunsByIds }, analysisOffByReader: () => true })

    // 装配层真的调用了挂载点——漏挂不会报错，只会让每张卡显示「这次没查到」。
    expect(addReader).toHaveBeenCalledTimes(1)
    const reader = addReader.mock.calls[0]![0] as {
      rows: (hashes: readonly string[]) => unknown
      runs: (ids: readonly string[]) => unknown
      analysisOffByReader: () => boolean | Promise<boolean>
    }
    expect(reader.rows(['h-1'])).toHaveLength(1)
    expect(reader.runs(['mi-ar-1'])).toEqual({ 'mi-ar-1': { status: 'succeeded', failureCode: null } })
    expect(await reader.analysisOffByReader()).toBe(true)
  })
})
