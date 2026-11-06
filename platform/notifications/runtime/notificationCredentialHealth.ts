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
import type {
  NotificationContentByLanguage,
  NotificationSubmitOutcome,
  NotificationSubmitRequest
} from '../contracts/notificationContracts'
import type { NotificationStoreState } from '../store/notificationStore'
import { renderPlatformEventCopy } from '../producers/platformEventCopy'

export type ProviderCredentialState = 'ok' | 'invalid'

/**
 * 事件输入。`providerName` 是**读者看到的名字**（「OpenAI」），由组合根从已有的供应商配置里取来传下，
 * 不在这里查表：判定状态只认 id，名字属于展示，这一层再造一份映射就又成了两处来源。
 *
 * 没给名字 → **不提交通知**（判定状态照旧记下）。印 `providerId` 等于把内部标识摆到读者面前，
 * 而「未知」也不是这里该编的东西：源头没把事实备齐，就不该发。
 */
export type ProviderCredentialSignal = {
  providerId: string
  state: ProviderCredentialState
  providerName?: string
}

export async function reportProviderCredentialFlip(
  input: ProviderCredentialSignal,
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
  // 源头拼成品（契约 v2.56）：两种语言的句子都从文案表来，这里只填名字。
  // 名字没有 → 拼不出来 → 不提交；状态已经记下，所以下一次真实翻转不会被这次吞掉。
  const rendered = credentialCopy(input)
  if (rendered === undefined) return { changed: true }
  if (input.state === 'invalid') {
    await deps.submit({
      eventTypeId: 'platform.provider.credential-invalid',
      producerId: 'platform',
      dedupeVars: { builder: 'template', vars: { providerId: input.providerId } },
      rendered,
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
      rendered,
      actions: [],
      occurredAt: now
    })
  }
  return { changed: true }
}

/**
 * 名字在就拼两份成品；名字不在就返回 `undefined`。
 *
 * 供应商名是品牌名，两种语言同一份（`params`）；句子骨架仍在 `notificationCopy`，
 * 这一层不写字面量。
 */
function credentialCopy(input: ProviderCredentialSignal): NotificationContentByLanguage | undefined {
  const providerName = input.providerName?.trim()
  if (providerName === undefined || providerName.length === 0) return undefined
  return renderPlatformEventCopy({
    eventTypeId:
      input.state === 'invalid'
        ? 'platform.provider.credential-invalid'
        : 'platform.provider.credential-recovered',
    params: { provider: providerName }
  })
}
