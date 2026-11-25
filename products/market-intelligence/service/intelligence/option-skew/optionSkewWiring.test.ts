import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { OPTION_SKEW_COLLECT_JOB_ID } from './optionSkewJobId'
import { wireOptionSkew } from './optionSkewWiring'

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'option-skew-wiring-'))
}

function jobRuntimeStub() {
  return {
    registerHandler: vi.fn(),
    setSchedule: vi.fn(),
    removeSchedule: vi.fn(),
    enqueueManual: vi.fn(async () => undefined)
  }
}

function pointOf(day: string) {
  return {
    day, observedAt: `${day}T05:00:00.000Z`, riskReversal: 6.7, putIv25: 62.7, callIv25: 56,
    tenorDays: 30, expiries: ['2026-12-11T08:00:00.000Z', '2026-12-25T08:00:00.000Z'], underlyingPrice: 90_000
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

const unusedFetch = (() => { throw new Error('the wiring test must not go to the network') }) as never

describe('option skew wiring: startup catch-up', () => {
  it('runs one round at startup when the source is on and today has no point', async () => {
    const dataDir = await tempDir()
    const jobRuntime = jobRuntimeStub()
    const wiring = wireOptionSkew({
      jobRuntime: jobRuntime as never,
      platformFetch: unusedFetch,
      dataDir,
      isEnabled: async () => true,
      onReady: () => undefined
    })

    // 补跑走的是作业队列（有一条运行记录），不是悄悄跑一下。
    await wiring.ready
    expect(jobRuntime.enqueueManual).toHaveBeenCalledWith(OPTION_SKEW_COLLECT_JOB_ID)
  })

  it('stays quiet when today already has a point', async () => {
    const dataDir = await tempDir()
    await writeFile(join(dataDir, 'option-skew-points.json'), JSON.stringify({
      schemaVersion: 1, points: [pointOf(today())], consecutiveFailures: 0
    }), 'utf8')
    const jobRuntime = jobRuntimeStub()
    const wiring = wireOptionSkew({
      jobRuntime: jobRuntime as never,
      platformFetch: unusedFetch,
      dataDir,
      isEnabled: async () => true,
      onReady: () => undefined
    })

    await wiring.ready
    expect(jobRuntime.registerHandler).toHaveBeenCalled()
    expect(jobRuntime.enqueueManual).not.toHaveBeenCalled()
  })

  it('does not run when the reader has the source switched off', async () => {
    const dataDir = await tempDir()
    const jobRuntime = jobRuntimeStub()
    const wiring = wireOptionSkew({
      jobRuntime: jobRuntime as never,
      platformFetch: unusedFetch,
      dataDir,
      isEnabled: async () => false,
      onReady: () => undefined
    })

    await wiring.ready
    expect(jobRuntime.registerHandler).toHaveBeenCalled()
    expect(jobRuntime.enqueueManual).not.toHaveBeenCalled()
  })

  it('does not run on top of a store it cannot read', async () => {
    const dataDir = await tempDir()
    await writeFile(join(dataDir, 'option-skew-points.json'), '{ corrupt', 'utf8')
    const jobRuntime = jobRuntimeStub()
    const wiring = wireOptionSkew({
      jobRuntime: jobRuntime as never,
      platformFetch: unusedFetch,
      dataDir,
      isEnabled: async () => true,
      onReady: () => undefined
    })

    await wiring.ready
    expect(jobRuntime.registerHandler).toHaveBeenCalled()
    expect(jobRuntime.enqueueManual).not.toHaveBeenCalled()
  })
})
