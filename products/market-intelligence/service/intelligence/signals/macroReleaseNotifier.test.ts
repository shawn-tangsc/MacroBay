import { describe, expect, it, vi } from 'vitest'

import {
  buildMacroReleaseNoticeRequest,
  MACRO_RELEASE_PRODUCER_ID,
  notifyMacroReleases
} from './macroReleaseNotifier'

const notice = { eventId: 'US.CPI.RELEASE.2026-M09', releaseAt: '2026-10-14T01:30:00.000Z' }
const occurredAt = '2026-10-14T01:31:00.000Z'

describe('macro release notifier', () => {
  it('submits the declared event with the release key parameters and no action', () => {
    const request = buildMacroReleaseNoticeRequest(notice, occurredAt)
    expect(request.eventTypeId).toBe('market-intelligence.macro.event-landed')
    // The key is the platform's: `calendar:{eventId}:{releaseAt}`. The callsite only supplies vars.
    expect(request.dedupeVars).toEqual({ builder: 'template', vars: notice })
    expect(request.producerId).toBe(MACRO_RELEASE_PRODUCER_ID)
    expect(request.actions).toEqual([])
    expect(request.occurredAt).toBe(occurredAt)
  })

  it('sends one submission per release and counts only the accepted ones', async () => {
    const submit = vi.fn(async () => ({ kind: 'accepted' as const, recordId: 'r1', levels: [] }))
    const sent = await notifyMacroReleases(submit, [notice, { ...notice, eventId: 'US.PPI.RELEASE.2026-M09' }], occurredAt)
    expect(submit).toHaveBeenCalledTimes(2)
    expect(sent).toBe(2)
  })

  it('does nothing without a submit entry, and a failing submission does not throw', async () => {
    await expect(notifyMacroReleases(undefined, [notice], occurredAt)).resolves.toBe(0)
    const failed = vi.fn(async () => { throw new Error('notifications down') })
    await expect(notifyMacroReleases(failed, [notice], occurredAt)).resolves.toBe(0)
  })
})
