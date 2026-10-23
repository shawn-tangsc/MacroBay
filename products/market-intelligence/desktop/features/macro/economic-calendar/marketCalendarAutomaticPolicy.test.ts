import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { marketCalendarAutomaticRefreshPolicy } from './marketCalendarAutomaticPolicy'

const featureDirectory = 'products/market-intelligence/desktop/features/macro/economic-calendar'
const sourceStatus = readFileSync(resolve(process.cwd(), `${featureDirectory}/MarketCalendarSourceStatus.tsx`), 'utf8')
// Read the owning policy as text: the scheduler module is service-side, and the
// renderer test environment must not load its Node dependencies.
const schedulerSource = readFileSync(resolve(process.cwd(), 'products/market-intelligence/service/intelligence/macro-calendar/0xrouter-calendar/zeroXRouterCalendarScheduler.ts'), 'utf8')

describe('market calendar automatic refresh presentation', () => {
  it('keeps the displayed interval in step with the scheduler that owns it', () => {
    const declared = /intervalMs:\s*(\d+)\s*\*\s*60\s*\*\s*1_000/.exec(schedulerSource)
    expect(declared, 'the scheduler policy must declare its interval in minutes').not.toBeNull()
    expect(marketCalendarAutomaticRefreshPolicy.intervalMinutes).toBe(Number(declared![1]))
  })

  it('tells the user that the source updates automatically instead of implying a manual run', () => {
    expect(sourceStatus).toContain('marketCalendarAutomaticRefreshPolicy')
    expect(sourceStatus).toContain('data-automatic-refresh')
    expect(sourceStatus).toContain('automaticRefresh')
  })
})
