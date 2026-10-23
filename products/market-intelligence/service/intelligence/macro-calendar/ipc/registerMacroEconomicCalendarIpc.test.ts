import { describe, expect, it, vi } from 'vitest'

import { MACRO_ECONOMIC_CALENDAR_IPC_METHODS } from '../../../../contracts/macro/economicCalendarQueryContracts'
import { registerMacroEconomicCalendarIpc } from './registerMacroEconomicCalendarIpc'
import { marketCalendarPublicPolicy } from '../../../../contracts/macro/marketCalendarQueryContracts'

describe('registerMacroEconomicCalendarIpc', () => {
  it('registers exact market refresh/query boundaries and rejects unsafe service responses', async () => {
    const handlers = new Map<string, (payload: unknown) => unknown>()
    const scope = { month: '2026-09', locale: 'zh' }
    const input = { ...scope, asOf: '2026-09-10T00:00:00.000Z' }
    const page = { state: 'available', ...input, events: [], sources: marketCalendarPublicPolicy.kinds.map(eventType =>
      ({ eventType, status: 'unavailable', sourceObservedAt: null })) }
    const market = { queryMonth: vi.fn(() => page), refresh: vi.fn(async () => ({ state: 'unavailable', sources: [], failureCode: 'disabled' })) }
    registerMacroEconomicCalendarIpc((_id, method, handler) => handlers.set(method, handler), {
      listEffectiveMonthAsOf: () => [], getEffectiveEventAsOf: () => undefined
    } as never, {} as never, undefined, undefined, undefined, undefined, undefined, market)
    const query = handlers.get(marketCalendarPublicPolicy.methods.query)
    const refresh = handlers.get(marketCalendarPublicPolicy.methods.refresh)
    expect(query).toBeTypeOf('function'); expect(refresh).toBeTypeOf('function')
    expect(await query!(input)).toEqual(page)
    expect(await refresh!(scope)).toEqual({ state: 'unavailable', sources: [], failureCode: 'disabled' })
    expect(await refresh!({ ...scope, apiKey: 'forbidden' })).toMatchObject({ state: 'unavailable' })
    expect(market.refresh).toHaveBeenCalledOnce()
    market.queryMonth.mockReturnValue({ ...page, body: 'forbidden' } as never)
    expect(await query!(input)).toEqual({ state: 'unavailable', failureCode: 'query-unavailable' })
  })
  it('reconstructs only the exact BLS schedule-and-values aggregate', async () => {
    const handlers = new Map<string, (payload: unknown) => unknown>()
    const sync = vi.fn()
      .mockResolvedValueOnce({ state: 'completed', schedule: 'unchanged', values: { cpi: 'current', employment: 'updated' } })
      .mockResolvedValueOnce({ state: 'completed', schedule: 'unchanged', values: { cpi: 'current', employment: 'updated' }, rawBody: 'secret' })
    registerMacroEconomicCalendarIpc((_productId, method, handler) => handlers.set(method, handler), {
      listEffectiveMonthAsOf: () => [], getEffectiveEventAsOf: () => undefined
    } as never, { preview: () => ({ state: 'failed', failureCode: 'invalid-file' }), import: () => ({ state: 'failed', failureCode: 'invalid-file' }) } as never, undefined, undefined, undefined, { sync } as never)

    await expect(handlers.get(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.syncBlsEmploymentSchedule)?.({ year: '2026' })).resolves.toEqual({ state: 'completed', schedule: 'unchanged', values: { cpi: 'current', employment: 'updated' } })
    await expect(handlers.get(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.syncBlsEmploymentSchedule)?.({ year: '2026' })).resolves.toEqual({ state: 'unavailable' })
    expect(sync).toHaveBeenCalledTimes(2)
  })
  it('registers only the sealed confirmed FOMC refresh result and redacts dependency fields', async () => {
    const handlers = new Map<string, (payload: unknown) => unknown>()
    const refresh = vi.fn()
      .mockResolvedValueOnce({ state: 'updated' })
      .mockResolvedValueOnce({ state: 'updated', sourceUrl: 'https://secret.example.test', body: 'raw', evidenceHash: 'hash' })
    registerMacroEconomicCalendarIpc((_productId, method, handler) => handlers.set(method, handler), {
      listEffectiveMonthAsOf: () => [], getEffectiveEventAsOf: () => undefined
    } as never, { preview: () => ({ state: 'failed', failureCode: 'invalid-file' }), import: () => ({ state: 'failed', failureCode: 'invalid-file' }) } as never, undefined, undefined, undefined, undefined, { refresh } as never)

    await expect(handlers.get(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.refreshFedFomcDecision)?.({ eventKey: 'US.FOMC.2026-07-29', confirmed: true })).resolves.toEqual({ state: 'updated' })
    await expect(handlers.get(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.refreshFedFomcDecision)?.({ eventKey: 'US.FOMC.2026-07-29', confirmed: true })).resolves.toEqual({ state: 'unavailable' })
    await expect(handlers.get(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.refreshFedFomcDecision)?.({ eventKey: 'US.FOMC.2026-07-29', confirmed: false })).resolves.toEqual({ state: 'unavailable' })
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('registers the sealed confirmed BLS employment refresh route and redacts service output', async () => {
    const handlers = new Map<string, (payload: unknown) => unknown>()
    const refresh = vi.fn(async () => ({ state: 'updated', rawBody: 'sensitive' }))
    registerMacroEconomicCalendarIpc((_productId, method, handler) => handlers.set(method, handler), {
      listEffectiveMonthAsOf: () => [], getEffectiveEventAsOf: () => undefined
    } as never, { preview: () => ({ state: 'failed', failureCode: 'invalid-file' }), import: () => ({ state: 'failed', failureCode: 'invalid-file' }) } as never, undefined, undefined, { refresh } as never)

    await expect(handlers.get('intelligence.macro.economicCalendar.refreshBlsEmploymentRelease')?.({ eventKey: 'US.NONFARM_PAYROLLS.RELEASE.group', confirmed: true })).resolves.toEqual({ state: 'unavailable' })
    await expect(handlers.get('intelligence.macro.economicCalendar.refreshBlsEmploymentRelease')?.({ eventKey: 'US.NONFARM_PAYROLLS.RELEASE.group', confirmed: false })).resolves.toEqual({ state: 'unavailable' })
    await expect(handlers.get('intelligence.macro.economicCalendar.refreshBlsEmploymentRelease')?.({ eventKey: 'US.NONFARM_PAYROLLS.RELEASE.group', confirmed: true, extra: 'hostile' })).resolves.toEqual({ state: 'unavailable' })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it.each(['updated', 'unchanged', 'unavailable'] as const)('reconstructs only the declared BLS refresh state %s', async (state) => {
    const handlers = new Map<string, (payload: unknown) => unknown>()
    registerMacroEconomicCalendarIpc((_productId, method, handler) => handlers.set(method, handler), {
      listEffectiveMonthAsOf: () => [], getEffectiveEventAsOf: () => undefined
    } as never, { preview: () => ({ state: 'failed', failureCode: 'invalid-file' }), import: () => ({ state: 'failed', failureCode: 'invalid-file' }) } as never, undefined, undefined, { refresh: () => ({ state }) } as never)

    await expect(handlers.get(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.refreshBlsEmploymentRelease)?.({ eventKey: 'US.CPI.RELEASE.2026-M07', confirmed: true })).resolves.toEqual({ state })
  })
  it('accepts only a fixed provider input for the provider-scoped safe connection method', async () => {
    const handlers = new Map<string, (payload: unknown) => unknown>()
    const connection = { testProviderConnection: vi.fn(async () => ({ state: 'succeeded' })) }
    registerMacroEconomicCalendarIpc((_productId, method, handler) => handlers.set(method, handler), {
      listEffectiveMonthAsOf: () => [], getEffectiveEventAsOf: () => undefined
    } as never, { preview: () => ({ state: 'failed', failureCode: 'invalid-file' }), import: () => ({ state: 'failed', failureCode: 'invalid-file' }) } as never, undefined, connection as never)

    await expect(handlers.get('intelligence.macro.economicCalendar.testProviderConnection')?.({ providerId: 'macro-calendar-fed' })).resolves.toEqual({ state: 'succeeded' })
    await expect(handlers.get('intelligence.macro.economicCalendar.testProviderConnection')?.({ providerId: 'macro-calendar-fed', extra: true })).resolves.toEqual({ state: 'failed', failureCode: 'response-unavailable' })
    expect(connection.testProviderConnection).toHaveBeenCalledWith('macro-calendar-fed')
  })

  it('rejects a foreign provider before invoking the Macro Calendar connection service', async () => {
    const handlers = new Map<string, (payload: unknown) => unknown>()
    const connection = { testProviderConnection: vi.fn(async () => ({ state: 'succeeded' })) }
    registerMacroEconomicCalendarIpc((_productId, method, handler) => handlers.set(method, handler), {
      listEffectiveMonthAsOf: () => [], getEffectiveEventAsOf: () => undefined
    } as never, { preview: () => ({ state: 'failed', failureCode: 'invalid-file' }), import: () => ({ state: 'failed', failureCode: 'invalid-file' }) } as never, undefined, connection as never)

    await expect(handlers.get(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.testProviderConnection)?.({ providerId: 'macro-calendar-bls' })).resolves.toEqual({ state: 'failed', failureCode: 'response-unavailable' })
    expect(connection.testProviderConnection).not.toHaveBeenCalled()
  })

  it('fails closed for an accessor provider input before invoking the connection service', async () => {
    const handlers = new Map<string, (payload: unknown) => unknown>()
    const connection = { testProviderConnection: vi.fn(async () => ({ state: 'succeeded' })) }
    registerMacroEconomicCalendarIpc((_productId, method, handler) => handlers.set(method, handler), {
      listEffectiveMonthAsOf: () => [], getEffectiveEventAsOf: () => undefined
    } as never, { preview: () => ({ state: 'failed', failureCode: 'invalid-file' }), import: () => ({ state: 'failed', failureCode: 'invalid-file' }) } as never, undefined, connection as never)
    const payload = Object.defineProperty({}, 'providerId', { enumerable: true, get: () => 'macro-calendar-fed' })

    await expect(handlers.get(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.testProviderConnection)?.(payload)).resolves.toEqual({ state: 'failed', failureCode: 'response-unavailable' })
    expect(connection.testProviderConnection).not.toHaveBeenCalled()
  })

  it('fails closed for a non-plain provider input before invoking the connection service', async () => {
    const handlers = new Map<string, (payload: unknown) => unknown>()
    const connection = { testProviderConnection: vi.fn(async () => ({ state: 'succeeded' })) }
    registerMacroEconomicCalendarIpc((_productId, method, handler) => handlers.set(method, handler), {
      listEffectiveMonthAsOf: () => [], getEffectiveEventAsOf: () => undefined
    } as never, { preview: () => ({ state: 'failed', failureCode: 'invalid-file' }), import: () => ({ state: 'failed', failureCode: 'invalid-file' }) } as never, undefined, undefined, connection as never)
    const payload = Object.assign(Object.create({ inherited: 'foreign' }), { providerId: 'macro-calendar-fed' })

    await expect(handlers.get(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.testProviderConnection)?.(payload)).resolves.toEqual({ state: 'failed', failureCode: 'response-unavailable' })
    expect(connection.testProviderConnection).not.toHaveBeenCalled()
  })

  it('fails closed for an accessor provider-save input before invoking settings', async () => {
    const handlers = new Map<string, (payload: unknown) => unknown>()
    const saveProfile = vi.fn(async () => ({ state: 'failed', failureCode: 'provider-settings-unavailable' }))
    registerMacroEconomicCalendarIpc((_productId, method, handler) => handlers.set(method, handler), {
      listEffectiveMonthAsOf: () => [], getEffectiveEventAsOf: () => undefined
    } as never, { preview: () => ({ state: 'failed', failureCode: 'invalid-file' }), import: () => ({ state: 'failed', failureCode: 'invalid-file' }) } as never, {
      getPageState: () => ({ state: 'unavailable', failureCode: 'provider-settings-unavailable' }),
      saveProfile,
      runProviderNow: () => ({ state: 'failed', failureCode: 'provider-settings-unavailable' }),
      getProviderHealth: () => ({ state: 'unavailable', failureCode: 'provider-settings-unavailable' }),
      getProviderSchedule: () => ({ state: 'unavailable', failureCode: 'provider-settings-unavailable' })
    } as never)
    const payload = Object.defineProperties({}, {
      providerId: { enumerable: true, get: () => 'macro-calendar-fed' },
      enabled: { enumerable: true, value: true }
    })

    await expect(handlers.get(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.saveProviderProfile)?.(payload)).resolves.toEqual({ state: 'failed', failureCode: 'provider-settings-unavailable' })
    expect(saveProfile).not.toHaveBeenCalled()
  })
  it('registers exactly the two read-only calendar methods and returns safe invalid results', async () => {
    const handlers = new Map<string, (payload: unknown) => unknown>()
    const importService = {
      preview: () => ({ state: 'failed', failureCode: 'invalid-file' }),
      import: () => ({ state: 'failed', failureCode: 'invalid-file' })
    }
    registerMacroEconomicCalendarIpc((_productId, method, handler) => handlers.set(method, handler), {
      listEffectiveMonthAsOf: () => [], getEffectiveEventAsOf: () => undefined
    } as never, importService as never)

    // 10 read methods plus the two release-time writes the reader's editor uses.
    expect([...handlers]).toHaveLength(12)
    await expect(handlers.get(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.queryMonth)?.({ month: '2026-08' })).resolves.toEqual({ state: 'unavailable', failureCode: 'query-input-invalid' })
    await expect(handlers.get(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.getEventDetail)?.({ eventKey: 'US.FOMC.2026-12-09', asOf: '2026-08-04T00:00:00.000Z' })).resolves.toEqual({ state: 'unavailable', failureCode: 'event-not-found' })
    await expect(handlers.get(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.previewManualBlsIcs)?.({ body: 'bad', truncated: false })).resolves.toEqual({ state: 'failed', failureCode: 'invalid-file' })
    await expect(handlers.get(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.importManualBlsIcs)?.({ body: 'bad', truncated: false })).resolves.toEqual({ state: 'failed', failureCode: 'invalid-file' })
  })

  it('registers fixed provider settings IPC methods and redacts malformed runtime service output', async () => {
    const handlers = new Map<string, (payload: unknown) => unknown>()
    registerMacroEconomicCalendarIpc((_productId, method, handler) => handlers.set(method, handler), {
      listEffectiveMonthAsOf: () => [], getEffectiveEventAsOf: () => undefined
    } as never, { preview: () => ({ state: 'failed', failureCode: 'invalid-file' }), import: () => ({ state: 'failed', failureCode: 'invalid-file' }) } as never, {
      getPageState: () => ({ state: 'available', providers: [], sourceUrl: 'https://secret.example.test' }),
      saveProfile: () => ({ state: 'saved', provider: { sourceUrl: 'https://secret.example.test' } }),
      runProviderNow: () => ({ state: 'queued', providerId: 'macro-calendar-fed', credential: 'secret' }),
      getProviderHealth: () => ({ state: 'available', providers: [] })
    } as never)

    expect([...handlers]).toHaveLength(17)
    await expect(handlers.get(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.getProviderPageState)?.({})).resolves.toEqual({ state: 'unavailable', failureCode: 'provider-settings-unavailable' })
    await expect(handlers.get(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.saveProviderProfile)?.({ providerId: 'macro-calendar-fed', enabled: true, sourceUrl: 'https://secret.example.test' })).resolves.toEqual({ state: 'failed', failureCode: 'provider-settings-unavailable' })
    await expect(handlers.get(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.runProviderNow)?.({ providerId: 'macro-calendar-fed' })).resolves.toEqual({ state: 'failed', failureCode: 'provider-settings-unavailable' })
    await expect(handlers.get(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.getProviderHealth)?.({ providerId: 'macro-calendar-fed', credential: 'secret' })).resolves.toEqual({ state: 'unavailable', failureCode: 'provider-settings-unavailable' })
  })

  it.each([
    [{ state: 'completed', providerId: 'macro-calendar-fed', outcome: 'succeeded' }, { state: 'completed', providerId: 'macro-calendar-fed', outcome: 'succeeded' }],
    [{ state: 'completed', providerId: 'macro-calendar-fed', outcome: 'failed' }, { state: 'completed', providerId: 'macro-calendar-fed', outcome: 'failed' }],
    [{ state: 'completed', providerId: 'macro-calendar-bea', outcome: 'succeeded' }, { state: 'failed', failureCode: 'provider-settings-unavailable' }],
    [{ state: 'completed', providerId: 'macro-calendar-fed', outcome: 'succeeded', extra: 'secret' }, { state: 'failed', failureCode: 'provider-settings-unavailable' }]
  ])('reconstructs only exact completion outcome %o', async (serviceResult, expected) => {
    const handlers = new Map<string, (payload: unknown) => unknown>()
    registerMacroEconomicCalendarIpc((_productId, method, handler) => handlers.set(method, handler), {
      listEffectiveMonthAsOf: () => [], getEffectiveEventAsOf: () => undefined
    } as never, { preview: () => ({ state: 'failed', failureCode: 'invalid-file' }), import: () => ({ state: 'failed', failureCode: 'invalid-file' }) } as never, {
      getPageState: () => ({ state: 'unavailable', failureCode: 'provider-settings-unavailable' }),
      saveProfile: () => ({ state: 'failed', failureCode: 'provider-settings-unavailable' }),
      runProviderNow: () => serviceResult,
      getProviderHealth: () => ({ state: 'unavailable', failureCode: 'provider-settings-unavailable' })
    } as never)

    await expect(handlers.get(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.runProviderNow)?.({ providerId: 'macro-calendar-fed' })).resolves.toEqual(expected)
  })

  it('fails closed for a throwing Proxy input without invoking the provider service', async () => {
    const handlers = new Map<string, (payload: unknown) => unknown>()
    const runProviderNow = vi.fn(() => ({ state: 'completed', providerId: 'macro-calendar-fed', outcome: 'succeeded' }))
    registerMacroEconomicCalendarIpc((_productId, method, handler) => handlers.set(method, handler), {
      listEffectiveMonthAsOf: () => [], getEffectiveEventAsOf: () => undefined
    } as never, { preview: () => ({ state: 'failed', failureCode: 'invalid-file' }), import: () => ({ state: 'failed', failureCode: 'invalid-file' }) } as never, {
      getPageState: () => ({ state: 'unavailable', failureCode: 'provider-settings-unavailable' }),
      saveProfile: () => ({ state: 'failed', failureCode: 'provider-settings-unavailable' }),
      runProviderNow,
      getProviderHealth: () => ({ state: 'unavailable', failureCode: 'provider-settings-unavailable' })
    } as never)
    const payload = new Proxy({}, { getPrototypeOf() { throw new Error('secret') } })

    await expect(handlers.get(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.runProviderNow)?.(payload)).resolves.toEqual({ state: 'failed', failureCode: 'provider-settings-unavailable' })
    expect(runProviderNow).not.toHaveBeenCalled()
  })

  it('redacts a repository failure rather than surfacing storage or URL details', async () => {
    const handlers = new Map<string, (payload: unknown) => unknown>()
    registerMacroEconomicCalendarIpc((_productId, method, handler) => handlers.set(method, handler), {
      listEffectiveMonthAsOf: () => { throw new Error('sqlite /private/calendar.sqlite https://secret.example.test/?credential=raw') },
      getEffectiveEventAsOf: () => undefined
    } as never, { preview: () => ({ state: 'failed', failureCode: 'invalid-file' }), import: () => ({ state: 'failed', failureCode: 'invalid-file' }) } as never)

    const result = await handlers.get(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.queryMonth)?.({ month: '2026-08', asOf: '2026-08-04T00:00:00.000Z' })

    expect(result).toEqual({ state: 'unavailable', failureCode: 'calendar-query-unavailable' })
    expect(JSON.stringify(result)).not.toMatch(/sqlite|https?:|credential|raw/i)
  })

  it('redacts an unexpected manual import service exception at the IPC bridge', async () => {
    const handlers = new Map<string, (payload: unknown) => unknown>()
    registerMacroEconomicCalendarIpc((_productId, method, handler) => handlers.set(method, handler), {
      listEffectiveMonthAsOf: () => [], getEffectiveEventAsOf: () => undefined
    } as never, {
      preview: () => { throw new Error('raw body /private/bls.ics https://secret.example.test/?credential=raw') },
      import: () => { throw new Error('raw body /private/bls.ics https://secret.example.test/?credential=raw') }
    } as never)

    const preview = await handlers.get(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.previewManualBlsIcs)?.({ body: 'invalid', truncated: false })
    const imported = await handlers.get(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.importManualBlsIcs)?.({ body: 'invalid', truncated: false })
    expect(preview).toEqual({ state: 'failed', failureCode: 'persistence-failed' })
    expect(imported).toEqual({ state: 'failed', failureCode: 'persistence-failed' })
    expect(JSON.stringify({ preview, imported })).not.toMatch(/body|private|https?:|credential|raw/i)
  })

  it('returns each complete manual ICS success variant with exactly its public fields', async () => {
    const handlers = new Map<string, (payload: unknown) => unknown>()
    registerMacroEconomicCalendarIpc((_productId, method, handler) => handlers.set(method, handler), {
      listEffectiveMonthAsOf: () => [], getEffectiveEventAsOf: () => undefined
    } as never, {
      preview: () => ({
        state: 'ready', totalEvents: 313, supportedReleaseGroups: 46, generatedEvents: 115,
        unsupportedEvents: 198, insertedCount: 100, rescheduledCount: 10, unchangedCount: 5
      }),
      import: (input: { unchanged?: boolean }) => input.unchanged
        ? {
            state: 'unchanged', totalEvents: 313, supportedReleaseGroups: 46,
            generatedEvents: 115, unsupportedEvents: 198, unchangedCount: 115
          }
        : {
            state: 'imported', totalEvents: 313, supportedReleaseGroups: 46, generatedEvents: 115,
            unsupportedEvents: 198, insertedCount: 100, rescheduledCount: 10, unchangedCount: 5
          }
    } as never)

    await expect(handlers.get(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.previewManualBlsIcs)?.({})).resolves.toEqual({
      state: 'ready', totalEvents: 313, supportedReleaseGroups: 46, generatedEvents: 115,
      unsupportedEvents: 198, insertedCount: 100, rescheduledCount: 10, unchangedCount: 5
    })
    await expect(handlers.get(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.importManualBlsIcs)?.({})).resolves.toEqual({
      state: 'imported', totalEvents: 313, supportedReleaseGroups: 46, generatedEvents: 115,
      unsupportedEvents: 198, insertedCount: 100, rescheduledCount: 10, unchangedCount: 5
    })
    await expect(handlers.get(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.importManualBlsIcs)?.({ unchanged: true })).resolves.toEqual({
      state: 'unchanged', totalEvents: 313, supportedReleaseGroups: 46,
      generatedEvents: 115, unsupportedEvents: 198, unchangedCount: 115
    })
  })

  it.each([
    { preview: { state: 'ready', totalEvents: 1.5, supportedReleaseGroups: 1, generatedEvents: 1, unsupportedEvents: 0, insertedCount: 1, rescheduledCount: 0, unchangedCount: 0 } },
    { preview: { state: 'ready', totalEvents: 1, supportedReleaseGroups: 1, generatedEvents: 1, unsupportedEvents: 0, insertedCount: -1, rescheduledCount: 0, unchangedCount: 0 } },
    { preview: { state: 'failed', failureCode: 'raw-error', body: 'raw ics' } },
    { preview: { state: 'imported', totalEvents: 1, supportedReleaseGroups: 1, generatedEvents: 1, unsupportedEvents: 0, insertedCount: 1, rescheduledCount: 0, unchangedCount: 0 } },
    { preview: { state: 'ready', totalEvents: 1, supportedReleaseGroups: 1, generatedEvents: 1, unsupportedEvents: 0, insertedCount: 1, rescheduledCount: 0, unchangedCount: 0, sourceUrl: 'https://secret.example.test/bls.ics', body: 'raw ics', evidenceHash: 'hash', rawRecordId: 'raw-id', credential: 'secret', error: 'raw error' } },
    { imported: { state: 'unknown', sourceUrl: 'https://secret.example.test/bls.ics' } },
    { imported: { state: 'ready', totalEvents: 1, supportedReleaseGroups: 1, generatedEvents: 1, unsupportedEvents: 0, insertedCount: 1, rescheduledCount: 0, unchangedCount: 0 } },
    { imported: { state: 'imported', totalEvents: 1, supportedReleaseGroups: 1, generatedEvents: 1, unsupportedEvents: 0, insertedCount: 1, rescheduledCount: 0, unchangedCount: Number.MAX_SAFE_INTEGER + 1 } },
    { imported: { state: 'failed', failureCode: 'database-error', evidenceHash: 'hash' } },
    { imported: { state: 'unchanged', totalEvents: 1, supportedReleaseGroups: 1, generatedEvents: 1, unsupportedEvents: 0, unchangedCount: 1, sourceUrl: 'https://secret.example.test/bls.ics' } }
  ])('redacts malformed or unknown manual ICS dependency results', async ({ preview, imported }) => {
    const handlers = new Map<string, (payload: unknown) => unknown>()
    registerMacroEconomicCalendarIpc((_productId, method, handler) => handlers.set(method, handler), {
      listEffectiveMonthAsOf: () => [], getEffectiveEventAsOf: () => undefined
    } as never, {
      preview: () => preview ?? { state: 'failed', failureCode: 'invalid-file' },
      import: () => imported ?? { state: 'failed', failureCode: 'invalid-file' }
    } as never)

    const result = preview
      ? await handlers.get(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.previewManualBlsIcs)?.({})
      : await handlers.get(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.importManualBlsIcs)?.({})

    expect(result).toEqual({ state: 'failed', failureCode: 'persistence-failed' })
  })

  it.each(['invalid-file', 'unsupported-calendar', 'no-supported-events', 'persistence-failed'] as const)(
    'rebuilds the allowed manual ICS failure code %s',
    async (failureCode) => {
      const handlers = new Map<string, (payload: unknown) => unknown>()
      registerMacroEconomicCalendarIpc((_productId, method, handler) => handlers.set(method, handler), {
        listEffectiveMonthAsOf: () => [], getEffectiveEventAsOf: () => undefined
      } as never, {
        preview: () => ({ state: 'failed', failureCode }),
        import: () => ({ state: 'failed', failureCode })
      } as never)

      await expect(handlers.get(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.previewManualBlsIcs)?.({})).resolves.toEqual({ state: 'failed', failureCode })
      await expect(handlers.get(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.importManualBlsIcs)?.({})).resolves.toEqual({ state: 'failed', failureCode })
    }
  )
})
