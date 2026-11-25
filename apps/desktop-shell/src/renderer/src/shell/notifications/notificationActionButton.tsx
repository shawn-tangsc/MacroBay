import { Button } from 'antd'

import { isExternalUrl } from '@platform/notifications/contracts/externalUrl'
import type { NotificationCenterItem, NotificationDeeplink } from '@platform/notifications/contracts/notificationContracts'

/**
 * 一次动作要去的地方：外链，或应用内落点。
 *
 * **分组与画按钮都从这里取**，不许各算一遍——各算一遍就会出现「进了主位却没按钮」或
 * 「有按钮却落在仅记录」。判据本身也只有一个：`isExternalUrl` 与主进程出口共用。
 */
export type NotificationActionTarget =
  | { readonly kind: 'external'; readonly url: string }
  | { readonly kind: 'deeplink'; readonly deeplink: NotificationDeeplink }

export function notificationActionTarget(item: NotificationCenterItem): NotificationActionTarget | undefined {
  const action = item.actions[0]
  if (action === undefined) return undefined
  if (action.kind === 'open-external') {
    return isExternalUrl(action.url) ? { kind: 'external', url: action.url } : undefined
  }
  // **只有 `open` 会用应用内落点**。`custom` / `acknowledge` / `dismiss` / `snooze` 今天没有消费者，
  // 退到记录级 `deeplink` 就会画出一颗文案是「重试分析」、点下去却跳转的按钮——文案与行为不符，
  // 比没有按钮更糟。这条规则进待办 #79，等它们真有了执行通路再开。
  if (action.kind !== 'open') return undefined
  const deeplink = action.deeplink ?? item.deeplink
  return deeplink === undefined ? undefined : { kind: 'deeplink', deeplink }
}

/** 这一行有没有「能去的地方」——与按钮同一个判据，只是问法不同。 */
export function hasActionTarget(item: NotificationCenterItem): boolean {
  return notificationActionTarget(item) !== undefined
}


/**
 * 行标题的 id：动作按钮用 `aria-describedby` 指过来。
 *
 * 为什么需要：主位里一屏可能有好几条都叫「打开任务」「看原文」，读屏逐个 Tab 过去听到的是同一串名字，
 * 分不出是哪一条。**所有动作按钮同一套做法**——不给某一种开特例，否则下一个人只修自己那一颗。
 */
export function rowTitleId(itemId: string): string {
  return `notification-row-title-${itemId}`
}

/**
 * 主位行上的动作 = **这条通知要你做的事**，不是列表管理。
 *
 * 之前这里放的是「标为已读」——那是「我看过了」，不是「任务失败了你去看一眼」。记录里本来就有
 * `actions[0]`（如「打开任务」）与 `deeplink`，UI 不消费它，用户就只能点标记已读，事没做。
 *
 * 两种动作各有各的出口，**不许只认一种**：
 * - `kind: 'open'`（应用内落点）→ 把 `deeplink` 交给外壳；
 * - `kind: 'open-external'`（外链，如舆情那条「看原文」，验收 N37⑦ 明写中心用这个按钮）
 *   → 交给 `onOpenExternal` 开浏览器。之前只认落点，这类动作一个按钮都画不出来，
 *   等于记录里写着「看原文」而读者永远点不到。
 *
 * 外链只放行 http(s)：主进程出口会拒别的 scheme（`windowIpc.ts` 的 `shellOpenExternal`），
 * 递过去就是一个点了抛错的按钮（`openExternalProtocolGuard.test.ts` 守这条）。
 */
export function NotificationActionButton(props: {
  item: NotificationCenterItem
  onOpenDeeplink: (deeplink: NotificationDeeplink) => void
  onRead: (id: string) => Promise<void>
  onOpenExternal: (url: string) => Promise<unknown>
  onOpenExternalFailed: () => void
}): React.ReactElement | null {
  const action = props.item.actions[0]
  const target = notificationActionTarget(props.item)
  if (action === undefined || target === undefined) return null
  const label = action.label
  return (
    <Button
      size="small"
      aria-describedby={rowTitleId(props.item.id)}
      onClick={() => {
        // 一次操作两个效果：把人送到地方，同时把这条标成已读。
        // 只送不标的话，回来仍看见同一条未读，角标也不减，等于留了个没人用的钩子。
        if (props.item.state === 'unread') void props.onRead(props.item.id)
        if (target.kind === 'deeplink') {
          props.onOpenDeeplink(target.deeplink)
          return
        }
        // 打不开要说出来：调用点把 rejection 吞掉，就是「按钮点了没反应」那一类。日志只带
        // 记录 id 与动作 id，**不带 URL**（新闻链接可能带查询串里的凭据）。
        void props.onOpenExternal(target.url).catch((error: unknown) => {
          console.error('[notification] openExternal failed', {
            recordId: props.item.id,
            actionId: action.id,
            error
          })
          // 日志只进 devtools；读者要看到一句话，否则就是「点了没反应」。
          props.onOpenExternalFailed()
        })
      }}>
      {label}
    </Button>
  )
}

