import { describe, expect, it, vi } from 'vitest'

import { createBlsPythonRequestsBridge, blsPythonRequestsBridgePolicy } from './blsPythonRequestsBridge'

describe('BLS Python requests bridge', () => {
  it.each([
    ['cpi', ['CUUR0000SA0', 'CUUR0000SA0L1E']],
    ['employment', ['CES0000000001', 'LNS14000000', 'CES0500000003']]
  ] as const)('runs the fixed %s family request through one Python child', async (family, expectedSeries) => {
    const execFile = vi.fn(async (_file, args, _options) => {
      expect(args[0]).toBe('-c')
      expect(args[2]).toBe(JSON.stringify({ kind: 'calendar-family-values', family, period: '2026-M07' }))
      return { stdout: JSON.stringify({ state: 'response', status: 200, body: '{"status":"REQUEST_SUCCEEDED"}' }), stderr: '' }
    })
    const bridge = createBlsPythonRequestsBridge({ execFile, pythonPath: '/usr/local/bin/python3' })

    await expect(bridge.run({ kind: 'calendar-family-values', family, period: '2026-M07' })).resolves.toEqual({
      state: 'response', status: 200, body: '{"status":"REQUEST_SUCCEEDED"}'
    })
    expect(execFile).toHaveBeenCalledOnce()
    expect(execFile.mock.calls[0]![2]).toMatchObject({ timeout: blsPythonRequestsBridgePolicy.processDeadlineMs })
    expectedSeries.forEach((seriesId) => expect(execFile.mock.calls[0]![1]![1]).toContain(seriesId))
  })

  it('includes the P-13 December in the fixed January CPI window', async () => {
    const execFile = vi.fn(async (_file, args) => {
      expect(args[2]).toBe(JSON.stringify({ kind: 'calendar-family-values', family: 'cpi', period: '2026-M01' }))
      expect(args[1]).toContain('start_year = int(year) - (2 if operation["family"] == "cpi" and period.endswith("-M01") else 1)')
      expect(args[1]).toContain('"startyear": str(start_year), "endyear": year')
      return { stdout: JSON.stringify({ state: 'response', status: 200, body: '{"status":"REQUEST_SUCCEEDED"}' }), stderr: '' }
    })
    const bridge = createBlsPythonRequestsBridge({ execFile, pythonPath: '/usr/local/bin/python3' })

    await expect(bridge.run({ kind: 'calendar-family-values', family: 'cpi', period: '2026-M01' })).resolves.toEqual({
      state: 'response', status: 200, body: '{"status":"REQUEST_SUCCEEDED"}'
    })
  })

  it('rejects a foreign operation without starting Python', async () => {
    const execFile = vi.fn()
    const bridge = createBlsPythonRequestsBridge({ execFile, pythonPath: '/usr/local/bin/python3' })

    await expect(bridge.run({ kind: 'arbitrary-url' } as never)).resolves.toEqual({ state: 'unavailable' })
    expect(execFile).not.toHaveBeenCalled()
  })

  it('accepts only bounded named CPI and Employment annual schedule families', async () => {
    const employmentRows = annualRows('2026')
    const cpiRows = annualRows('2026')
    const execFile = vi.fn(async () => ({
      stdout: JSON.stringify({ state: 'schedule', employmentRows, cpiRows }), stderr: ''
    }))
    const bridge = createBlsPythonRequestsBridge({ execFile, pythonPath: '/usr/local/bin/python3' })

    await expect(bridge.run({ kind: 'employment-schedule', year: '2026' })).resolves.toEqual({
      state: 'schedule', employmentRows, cpiRows, rows: employmentRows
    })
  })

  it('rejects a schedule result without both exact annual families', async () => {
    const execFile = vi.fn(async () => ({
      stdout: JSON.stringify({ state: 'schedule', employmentRows: annualRows('2026') }), stderr: ''
    }))
    const bridge = createBlsPythonRequestsBridge({ execFile, pythonPath: '/usr/local/bin/python3' })

    await expect(bridge.run({ kind: 'employment-schedule', year: '2026' })).resolves.toEqual({ state: 'unavailable' })
  })

  it('rejects foreign natural-year periods for an annual page', async () => {
    const execFile = vi.fn(async () => ({
      stdout: JSON.stringify({ state: 'schedule', employmentRows: naturalYearRows('2025'), cpiRows: naturalYearRows('2025') }), stderr: ''
    }))
    const bridge = createBlsPythonRequestsBridge({ execFile, pythonPath: '/usr/local/bin/python3' })

    await expect(bridge.run({ kind: 'employment-schedule', year: '2026' })).resolves.toEqual({ state: 'unavailable' })
  })

  it('maps malformed or oversized child output to unavailable', async () => {
    const execFile = vi.fn(async () => ({ stdout: '{"state":"response"'.repeat(200_000), stderr: '' }))
    const bridge = createBlsPythonRequestsBridge({ execFile, pythonPath: '/usr/local/bin/python3' })

    await expect(bridge.run({ kind: 'calendar-family-values', family: 'employment', period: '2026-M07' })).resolves.toEqual({ state: 'unavailable' })
  })
})

function annualRows(year: string) {
  return [`${Number(year) - 1}-M12`, ...Array.from({ length: 11 }, (_, index) => `${year}-M${String(index + 1).padStart(2, '0')}`)]
    .map((referencePeriod, index) => ({
    releaseDate: `2026-${String(index + 1).padStart(2, '0')}-07`,
    referencePeriod
  }))
}

function naturalYearRows(year: string) {
  return Array.from({ length: 12 }, (_, index) => ({
    releaseDate: `2026-${String(index + 1).padStart(2, '0')}-07`,
    referencePeriod: `${year}-M${String(index + 1).padStart(2, '0')}`
  }))
}
