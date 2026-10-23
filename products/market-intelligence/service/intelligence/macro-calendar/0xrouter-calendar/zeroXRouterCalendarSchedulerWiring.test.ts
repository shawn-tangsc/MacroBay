import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { zeroXRouterCalendarSchedulerPolicy } from './zeroXRouterCalendarScheduler'

const bootstrap = readFileSync(resolve(process.cwd(), 'products/market-intelligence/service/bootstrap.ts'), 'utf8')

describe('market calendar automatic refresh wiring', () => {
  it('registers the 0xRouter scheduler at boot, not on first render', () => {
    expect(bootstrap).toContain('createZeroXRouterCalendarScheduler(')
    expect(bootstrap).toContain('void marketCalendarScheduler.initialize()')
    // Boot registration must not be gated behind a page or a user action; the
    // readiness gate is evaluated inside the job instead (design 118:65).
    expect(bootstrap).toMatch(/as const[\s\S]{0,300}?marketCalendarScheduler\.initialize\(\)/)
  })

  it('registers the BLS scheduler and enrolls credential-free providers before the official schedule', () => {
    expect(bootstrap).toContain('createBlsScheduleAndValuesScheduler(')
    expect(bootstrap).toContain('blsScheduleAndValuesScheduler.initialize()')
    // Enrollment must settle before the official interval job reads the profile
    // list, otherwise a first boot with all providers disabled would register no
    // schedule at all.
    expect(bootstrap).toMatch(/autoEnrollCalendarProviders\(\{ profiles: calendarProfiles, readyProviderIds: readyCalendarProviders \}\)[\s\S]{0,220}macroCalendarJobs\.initialize\(\)/)
  })

  it('disposes both schedulers so a disabled source cannot keep refreshing after teardown', () => {
    expect(bootstrap).toContain('marketCalendarScheduler.dispose()')
    expect(bootstrap).toContain('blsScheduleAndValuesScheduler.dispose()')
  })

  it('keeps the 30 minute cadence in the policy that owns it', () => {
    expect(zeroXRouterCalendarSchedulerPolicy.intervalMs).toBe(30 * 60 * 1_000)
    expect(zeroXRouterCalendarSchedulerPolicy.definitionId).toBe('market-intelligence.refreshMarketCalendar.automatic')
  })
})
