import { describe, expect, it, vi } from 'vitest'

import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import { LEGACY_PERIOD_MIGRATION_MARKER, runBriefingPeriodDataMigration } from './dailyBriefingPeriodDataMigration'
import type { BriefingPeriodStorage } from './dailyBriefingPeriodStore'

function memoryStorage(initial?: unknown): Readonly<{ storage: BriefingPeriodStorage; value: () => unknown }> {
  let value: unknown = initial
  return {
    storage: {
      read: async () => value,
      write: async (next) => { value = next }
    },
    value: () => value
  }
}

function deps(
  storage: BriefingPeriodStorage,
  overrides: Partial<Parameters<typeof runBriefingPeriodDataMigration>[0]> = {}
): Parameters<typeof runBriefingPeriodDataMigration>[0] {
  return {
    storage,
    readLegacyPeriods: async () => [],
    language: async (): Promise<DailyBriefingLocale> => 'zh-CN',
    additionalLanguages: async () => [],
    now: () => '2026-11-10T00:00:00.000Z',
    ...overrides
  }
}

const TWO_PERIODS = [
  // Deliberately not sorted by hour: a migration that "tidies" the list would show up here.
  { id: 'evening', generationTime: '20:00', windowHours: 12 },
  { id: 'default', generationTime: '07:00', windowHours: 24 }
] as const

describe('legacy period data migration', () => {
  it('moves every saved period verbatim, keeping id, time, window and order', async () => {
    const memory = memoryStorage()
    const result = await runBriefingPeriodDataMigration(deps(memory.storage, {
      readLegacyPeriods: async () => TWO_PERIODS
    }))

    expect(result.state).toBe('migrated')
    const document = memory.value() as { periods: readonly unknown[] }
    expect(document.periods).toEqual([
      { id: 'evening', generationTime: '20:00', windowHours: 12, language: 'zh-CN', origin: 'legacy-settings' },
      { id: 'default', generationTime: '07:00', windowHours: 24, language: 'zh-CN', origin: 'legacy-settings' }
    ])
  })

  it('adds the English edition the old global preference asked for, at the same hour and window', async () => {
    const memory = memoryStorage()
    const result = await runBriefingPeriodDataMigration(deps(memory.storage, {
      readLegacyPeriods: async () => [TWO_PERIODS[1]],
      additionalLanguages: async () => ['en-US']
    }))

    expect(result.state).toBe('migrated')
    const document = memory.value() as { periods: readonly { id: string; generationTime: string; windowHours: number; language: string }[] }
    expect(document.periods).toHaveLength(2)
    expect(document.periods.map((period) => period.language)).toEqual(['zh-CN', 'en-US'])
    expect(document.periods.map((period) => period.id)).toEqual(['default', 'period_legacy_default_en-US'])
    for (const period of document.periods) {
      expect(period.generationTime).toBe('07:00')
      expect(period.windowHours).toBe(24)
    }
  })

  it('writes the migration marker together with the periods', async () => {
    const memory = memoryStorage()
    await runBriefingPeriodDataMigration(deps(memory.storage, {
      readLegacyPeriods: async () => [TWO_PERIODS[1]]
    }))
    const document = memory.value() as { markers?: Record<string, string> }
    expect(document.markers?.[LEGACY_PERIOD_MIGRATION_MARKER]).toBe('2026-11-10T00:00:00.000Z')
  })

  it('skips a store that already holds periods, without reading the old file', async () => {
    const memory = memoryStorage({
      version: 1,
      periods: [{ id: 'mine', generationTime: '09:00', windowHours: 24, language: 'en-US' }]
    })
    const readLegacyPeriods = vi.fn(async () => TWO_PERIODS)
    const result = await runBriefingPeriodDataMigration(deps(memory.storage, { readLegacyPeriods }))

    expect(result.state).toBe('skipped')
    expect(readLegacyPeriods).not.toHaveBeenCalled()
    expect(memory.value()).toEqual({
      version: 1,
      periods: [{ id: 'mine', generationTime: '09:00', windowHours: 24, language: 'en-US' }]
    })
  })

  it('a second run leaves the file byte for byte identical', async () => {
    const memory = memoryStorage()
    const first = await runBriefingPeriodDataMigration(deps(memory.storage, { readLegacyPeriods: async () => TWO_PERIODS }))
    expect(first.state).toBe('migrated')
    const afterFirst = JSON.stringify(memory.value())

    const second = await runBriefingPeriodDataMigration(deps(memory.storage, { readLegacyPeriods: async () => TWO_PERIODS }))
    expect(second.state).toBe('skipped')
    expect(JSON.stringify(memory.value())).toBe(afterFirst)
  })

  it('does not resurrect periods the reader deleted after migrating', async () => {
    const memory = memoryStorage({
      version: 1,
      periods: [],
      markers: { [LEGACY_PERIOD_MIGRATION_MARKER]: '2026-11-10T00:00:00.000Z' }
    })
    const result = await runBriefingPeriodDataMigration(deps(memory.storage, {
      readLegacyPeriods: async () => TWO_PERIODS
    }))

    expect(result.state).toBe('skipped')
    expect((memory.value() as { periods: readonly unknown[] }).periods).toEqual([])
  })

  it('writes nothing when the old file has no periods', async () => {
    const memory = memoryStorage()
    const result = await runBriefingPeriodDataMigration(deps(memory.storage))

    expect(result.state).toBe('skipped')
    expect(memory.value()).toBeUndefined()
  })

  it('a failed write leaves the store empty and the marker unwritten', async () => {
    const memory = memoryStorage()
    const storage: BriefingPeriodStorage = {
      read: memory.storage.read,
      write: async () => { throw new Error('disk full') }
    }
    const result = await runBriefingPeriodDataMigration(deps(storage, {
      readLegacyPeriods: async () => TWO_PERIODS
    }))

    expect(result.state).toBe('failed')
    expect(memory.value()).toBeUndefined()
  })

  it('reports one diagnostic carrying the reason when the move fails', async () => {
    const memory = memoryStorage()
    const storage: BriefingPeriodStorage = {
      read: memory.storage.read,
      write: async () => { throw new Error('disk full') }
    }
    const log = vi.fn()
    const result = await runBriefingPeriodDataMigration(deps(storage, {
      readLegacyPeriods: async () => TWO_PERIODS,
      log
    }))

    expect(result.state).toBe('failed')
    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('error', 'briefing-period-migration-failed', { reason: 'disk full' })
  })
})
