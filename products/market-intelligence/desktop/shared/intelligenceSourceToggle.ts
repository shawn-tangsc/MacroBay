import { intelligenceSourcesClient } from './ipc/intelligenceSourcesClient'

type ToggleableSource = { sourceId: string; kind: string }

/**
 * Routes a source switch to the service that owns it. Official calendars are
 * provider profiles, not generic intelligence sources, so they must not go
 * through intelligenceSources.setEnabled.
 */
export async function setSourceEnabled(source: ToggleableSource, enabled: boolean): Promise<void> {
  if (source.kind === 'official-calendar' || source.kind === 'market-calendar') {
    const result = await intelligenceSourcesClient.setCalendarEnabled(source.sourceId, enabled)
    if (!result.ok) throw new Error(result.failureCode ?? 'calendar-toggle-failed')
    return
  }
  await intelligenceSourcesClient.setEnabled(source.sourceId, enabled)
}
