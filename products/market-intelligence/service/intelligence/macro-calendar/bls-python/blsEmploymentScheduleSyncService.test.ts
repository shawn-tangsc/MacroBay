import { describe, expect, it, vi } from 'vitest'

import type { MacroCalendarRevision } from '../macroCalendarContracts'
import { createBlsEmploymentScheduleSyncService } from './blsEmploymentScheduleSyncService'

const employmentRows = annualRows('2026', '07')
const cpiRows = annualRows('2026', '14')

describe('BLS Employment schedule sync service', () => {
  it('turns both fixed annual mappings into 60 stable date-only events and writes atomically', async () => {
    const appendManyIfNew = vi.fn(() => ({ insertedCount: 60, dedupedCount: 0 }))
    const bridge = { run: vi.fn(async () => ({ state: 'schedule' as const, rows: employmentRows, employmentRows, cpiRows })) }
    const service = createBlsEmploymentScheduleSyncService({ bridge, repository: { appendManyIfNew }, now: () => '2026-08-11T00:00:00.000Z' })

    const result = await service.sync({ year: '2026' })
    expect(result).toMatchObject({ state: 'completed', schedule: 'updated', groups: expect.arrayContaining([
      expect.objectContaining({ family: 'cpi', period: '2026-M07', eventKey: 'US.CPI.RELEASE.2026-M07' }),
      expect.objectContaining({ family: 'employment', period: '2026-M07', eventKey: 'US.NONFARM_PAYROLLS.RELEASE.2026-M07' })
    ]) })
    if (result.state === 'completed') {
      expect(result.groups).toHaveLength(24)
      expect(result.groups.every(Object.isFrozen)).toBe(true)
    }
    expect(bridge.run).toHaveBeenCalledWith({ kind: 'employment-schedule', year: '2026' })
    expect(appendManyIfNew).toHaveBeenCalledOnce()
    const revisions = appendManyIfNew.mock.calls[0]![0] as MacroCalendarRevision[]
    expect(revisions).toHaveLength(60)
    expect(revisions[0]).toMatchObject({
      eventKey: 'US.NONFARM_PAYROLLS.RELEASE.2025-M12',
      releaseGroupKey: 'US.EMPLOYMENT_SITUATION.RELEASE.2025-M12',
      periodKey: '2025-M12', scheduledDate: '2026-01-07',
      revisionKind: 'schedule', lifecycleState: 'scheduled',
      caveats: ['official-time-not-published', 'official-timezone-not-published', 'bls-python-schedule']
    })
    expect(revisions).toContainEqual(expect.objectContaining({
      eventKey: 'US.CPI.RELEASE.2025-M12',
      releaseGroupKey: 'US.CPI.RELEASE.2025-M12',
      eventFamily: 'consumer-price-index',
      eventNameKey: 'cpi',
      scheduledDate: '2026-01-14'
    }))
    expect(revisions).toContainEqual(expect.objectContaining({
      eventKey: 'US.CORE_CPI.RELEASE.2025-M12',
      releaseGroupKey: 'US.CPI.RELEASE.2025-M12',
      eventFamily: 'consumer-price-index',
      eventNameKey: 'core-cpi'
    }))
  })

  it('fails closed when either annual family is incomplete without writing', async () => {
    const appendManyIfNew = vi.fn()
    const bridge = { run: vi.fn(async () => ({ state: 'schedule' as const, rows: employmentRows, employmentRows, cpiRows: cpiRows.slice(0, 11) })) }
    const service = createBlsEmploymentScheduleSyncService({ bridge, repository: { appendManyIfNew }, now: () => '2026-08-11T00:00:00.000Z' })

    await expect(service.sync({ year: '2026' })).resolves.toEqual({ state: 'unavailable' })
    expect(appendManyIfNew).not.toHaveBeenCalled()
  })

  it('rejects a foreign natural-year family without writing', async () => {
    const appendManyIfNew = vi.fn()
    const foreignRows = Array.from({ length: 12 }, (_, index) => ({
      releaseDate: `2026-${String(index + 1).padStart(2, '0')}-07`,
      referencePeriod: `2025-M${String(index + 1).padStart(2, '0')}` as `${number}-M${string}`
    }))
    const bridge = { run: vi.fn(async () => ({ state: 'schedule' as const, rows: foreignRows, employmentRows: foreignRows, cpiRows: foreignRows })) }
    const service = createBlsEmploymentScheduleSyncService({ bridge, repository: { appendManyIfNew }, now: () => '2026-08-11T00:00:00.000Z' })

    await expect(service.sync({ year: '2026' })).resolves.toEqual({ state: 'unavailable' })
    expect(appendManyIfNew).not.toHaveBeenCalled()
  })
})

function annualRows(year: string, day: string) {
  return [`${Number(year) - 1}-M12`, ...Array.from({ length: 11 }, (_, index) => `${year}-M${String(index + 1).padStart(2, '0')}`)]
    .map((referencePeriod, index) => ({
      releaseDate: `2026-${String(index + 1).padStart(2, '0')}-${day}`,
      referencePeriod: referencePeriod as `${number}-M${string}`
    }))
}
