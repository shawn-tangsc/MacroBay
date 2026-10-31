import { describe, expect, it } from 'vitest'

import { createMacroCalendarRepository } from '../macro-calendar/macroCalendarRepository'
import { createPolicyPathMarketLinkStore } from './policyPathMarketLinkStore'

// The table is created by the calendar migrations, so the test opens a real repository first.
const store = () => {
  const repository = createMacroCalendarRepository({ filePath: ':memory:' })
  return { links: repository.policyMarketLinks, close: () => repository.close() }
}

describe('market link store', () => {
  it('turns a stored slug into the venue page the reader can open', () => {
    const { links, close } = store()
    links.record({ meetingDate: '2026-12-09', slug: 'fed-decision-in-december-20260729232808632', detectedAt: '2026-10-31T00:00:00.000Z' })
    expect(links.read('2026-12-09')).toEqual({
      meetingDate: '2026-12-09',
      slug: 'fed-decision-in-december-20260729232808632',
      url: 'https://polymarket.com/event/fed-decision-in-december-20260729232808632',
      detectedAt: '2026-10-31T00:00:00.000Z'
    })
    close()
  })

  it('keeps the newest slug for a meeting instead of appending', () => {
    const { links, close } = store()
    links.record({ meetingDate: '2026-12-09', slug: 'old-slug', detectedAt: '2026-10-30T00:00:00.000Z' })
    links.record({ meetingDate: '2026-12-09', slug: 'new-slug', detectedAt: '2026-10-31T00:00:00.000Z' })
    expect(links.read('2026-12-09')?.slug).toBe('new-slug')
    close()
  })

  it('answers nothing for a meeting it has never seen', () => {
    const { links, close } = store()
    expect(links.read('2026-12-09')).toBeUndefined()
    close()
  })
})
