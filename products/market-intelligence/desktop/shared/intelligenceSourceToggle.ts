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
  const result = await intelligenceSourcesClient.setEnabled(source.sourceId, enabled)
  if (result.state === 'rejected') {
    // 拒绝是服务端的结果：把原因码带出来（界面据此说清「先配钥匙」），而不是吞成成功。
    throw Object.assign(new Error(result.reasonCode), { reasonCode: result.reasonCode })
  }
}
