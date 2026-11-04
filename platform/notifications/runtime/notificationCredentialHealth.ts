/**
 * 供应商凭据的判定状态（P4a/P4b 的唯一提交点）。
 *
 * 它只管一件事：**把「这个供应商现在是不是失效」记下来，并在翻转时发一条事件**。
 * 不碰文件、不碰通知内容——写入走调用方给的 `persistWithDiagnostics`，与记录同一份 JSON、
 * 同一个写入队列（设置文件是读者的配置，这份判定状态不是）。
 *
 * 两条铁律：
 * - 只认 `ok` / `invalid` 两个值：读不到就说不知道，那就不发事件，没有第三态；
 * - 只有翻转才发（invalid→invalid 不重复发），重启后读回同一份 state 也不会重发。
 */
import type { NotificationSubmitOutcome, NotificationSubmitRequest } from '../contracts/notificationContracts'
import type { NotificationStoreState } from '../store/notificationStore'

export type ProviderCredentialState = 'ok' | 'invalid'

export async function reportProviderCredentialFlip(
  input: { providerId: string; state: ProviderCredentialState },
  deps: {
    load: () => Promise<NotificationStoreState>
    persistWithDiagnostics: (state: NotificationStoreState) => Promise<void>
    notifyChanged: () => void
    submit: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>
    now: () => string
  }
): Promise<{ changed: boolean }> {
  const state = await deps.load()
  const previous = state.providerCredentialHealth[input.providerId]
  if (previous === input.state) return { changed: false }
  await deps.persistWithDiagnostics({
    ...state,
    providerCredentialHealth: { ...state.providerCredentialHealth, [input.providerId]: input.state }
  })
  deps.notifyChanged()
  const now = deps.now()
  if (input.state === 'invalid') {
    await deps.submit({
      eventTypeId: 'platform.provider.credential-invalid',
      producerId: 'platform',
      dedupeVars: { builder: 'template', vars: { providerId: input.providerId } },
      actions: [
        {
          id: 'open-model-settings',
          labelKey: 'notification.action.open-settings',
          kind: 'open',
          deeplink: { scope: 'platform', settingsSectionId: 'model-service' }
        }
      ],
      occurredAt: now
    })
  } else {
    await deps.submit({
      eventTypeId: 'platform.provider.credential-recovered',
      producerId: 'platform',
      dedupeVars: {
        builder: 'template',
        vars: { providerId: input.providerId, day: now.slice(0, 10) }
      },
      actions: [],
      occurredAt: now
    })
  }
  return { changed: true }
}
