import { useCallback, useEffect, useState } from 'react'
import { Button } from 'antd'

import { LoadingState } from '@platform/ui/components/loading'
import { StateView } from '@platform/ui/components/state'
import { Drawer } from '@platform/ui/components/drawer'
import type {
  NotificationCenterItem,
  NotificationDeeplink
} from '@platform/notifications/contracts/notificationContracts'

import type { PlatformText } from '../../i18n/platformText'

import { createNotificationCenterSource, type NotificationCenterSource } from './notificationCenterSource'
import type { NotificationCenterSettingsEntry } from './notificationCenterSettingsEntry'

import './notificationCenter.css'

/**
 * 抽屉面板的 id：铃铛的 `aria-controls` 指向它。
 *
 * 只在抽屉打开时存在——所以铃铛那边**只在打开时**输出 `aria-controls`。指向一个不存在的 id
 * 比不写更糟：读屏会给出一个跳到空处的指令。
 */
export const NOTIFICATION_CENTER_PANEL_ID = 'notification-center-panel'

export const CENTER_TITLE_KEY = 'notifications.centerTitle'

type NotificationCenterDrawerProps = {
  open: boolean
  onClose: () => void
  labels: PlatformText['notifications']
  /** 通知自带的动作要真的做那件事：把 deeplink 交给外壳打开，而不是再标一次已读。 */
  onOpenDeeplink: (deeplink: NotificationDeeplink) => void
  /**
   * 外链动作（`open-external`）的出口：舆情那条「看原文」就是它（验收 N37⑦）。
   *
   * 与 `onOpenDeeplink` 分开：一个交给外壳导航，一个交浏览器打开。合并成一个回调会让调用方
   * 自己判「这是落点还是网址」，那套判断就跑到两个地方去了。
   *
   * **必填**：`hasActionTarget` 把外链算作「有地方可去」，行因此进主位、必须有按钮。
   * 做成可选就会留下一个只有类型才看得见的洞——调用点漏传时，那一行进未读组却一颗按钮都没有。
   */
  onOpenExternal: (url: string) => void
  source?: NotificationCenterSource
  /**
   * 产品注册的设置抽屉（`productSettingsDrawers` 里声明了 `notifications` 那一屏）。
   * **没有就是 null**：不渲染按钮——不要为了「完整」摆一个点了没反应的入口。
   */
  settingsEntry?: NotificationCenterSettingsEntry | null
  onOpenSettings?: (entry: NotificationCenterSettingsEntry) => void
}

/** 外链只放行 http(s)：主进程出口会拒别的 scheme，递过去就是点了抛错的按钮。 */
const EXTERNAL_URL = /^https?:\/\//i

/**
 * 这一行有没有「能去的地方」：应用内落点，或外链动作。
 *
 * 只认落点会把「看原文」整段归到「仅记录」，按钮永远画不出来——记录里写着动作、读者点不到。
 */
function hasActionTarget(item: NotificationCenterItem): boolean {
  const action = item.actions[0]
  if (action?.kind === 'open-external' && typeof action.url === 'string' && EXTERNAL_URL.test(action.url)) return true
  return (action?.deeplink ?? item.deeplink) !== undefined
}

/**
 * 四态。`error` 是「读失败、知道要重试」；`unknown` 是「连读失败还是本来就为空都判不出来」——
 * 后者必须走 `notification-unknown`，不能退成空态（那是在说「没有」）、也不能推到权限态。
 */
type LoadState = 'loading' | 'ready' | 'error' | 'unknown'

/**
 * 通知中心抽屉。
 *
 * 口径（界面设计十条验收里的硬约束）：
 * - 未读组在上、组内按时间倒序（排序来自查询 `unreadFirst`，渲染层不再排）；
 * - 每条都有且只有一个动作控件；「清空」= 全部标已读，**条数不变、不删除**；
 * - 真删除只在「删除已读」按钮上，且只删已读、要有二次确认；
 * - 空态、错误态一律 `StateView`，加载一律 `LoadingState`；
 * - 这里**不出现任何权限状态字样**——权限只在设置页一句手动说明。
 */
export function NotificationCenterDrawer({
  open,
  onClose,
  labels,
  onOpenDeeplink,
  onOpenExternal,
  source,
  settingsEntry,
  onOpenSettings
}: NotificationCenterDrawerProps): React.ReactElement {
  const [state, setState] = useState<LoadState>('loading')
  const [items, setItems] = useState<readonly NotificationCenterItem[]>([])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const centre = source ?? createNotificationCenterSource()
    try {
      const page = await centre.list()
      // 回了对象但 `items` 不是数组：这既不是成功，也不是一个能说出原因的错误。
      // 归到 `unknown` 而不是 `error`，因为 `error` 承诺「可以重试就好了」，这里没人能保证。
      if (!isNotificationPage(page)) {
        setState('unknown')
        return
      }
      setItems(page.items)
      setState('ready')
    } catch {
      setState('error')
    }
  }, [source])

  useEffect(() => {
    if (!open) return
    setState('loading')
    setNotice(null)
    setConfirmDelete(false)
    void load()
  }, [open, load])

  async function markAllRead(): Promise<void> {
    const centre = source ?? createNotificationCenterSource()
    const unread = await centre.markAllRead()
    // 清空只是把状态改成已读：条数一条不减少。
    setItems((current) => current.map((item) => (item.state === 'unread' ? { ...item, state: 'read' } : item)))
    setNotice(unread.unread === 0 ? labels.centerReadDone : null)
  }

  async function markOneRead(id: string): Promise<void> {
    const centre = source ?? createNotificationCenterSource()
    const next = await centre.markRead(id)
    setItems((current) => current.map((item) => (item.id === id ? next : item)))
  }

  async function deleteRead(): Promise<void> {
    const centre = source ?? createNotificationCenterSource()
    const result = await centre.deleteRead()
    // 只移除已读：未读一条不动（服务端同一口径，这里只是别让界面先撒谎）。
    setItems((current) => current.filter((item) => item.state !== 'read'))
    setConfirmDelete(false)
    setNotice(result.deleted === 0 ? labels.centerDeleteReadEmpty : labels.centerDeleteReadDone(String(result.deleted)))
  }

  // 有地方可去的通知才进主位；落点与外链都算「有地方可去」，两者都没有的只留记录（A3）。
  const actionables = items.filter(hasActionTarget)
  const recorded = items.filter((item) => !hasActionTarget(item))
  const unreadItems = actionables.filter((item) => item.state === 'unread')
  const readItems = actionables.filter((item) => item.state !== 'unread')

  return (
    <Drawer
      mode="modal"
      size="large"
      open={open}
      onClose={onClose}
      titleKey={CENTER_TITLE_KEY}
      resolveText={(key) => (key === CENTER_TITLE_KEY ? labels.centerTitle : '')}
      footer={
        <div className="notification-center-footer">
          {confirmDelete ? (
            <>
              <span className="notification-center-confirm">{labels.centerDeleteReadConfirm}</span>
              <Button danger onClick={() => void deleteRead()} size="small">
                {labels.centerDeleteRead}
              </Button>
              <Button onClick={() => setConfirmDelete(false)} size="small">
                {labels.centerCancel}
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => void markAllRead()} size="small" disabled={unreadItems.length === 0}>
                {labels.centerMarkAllRead}
              </Button>
              <Button
                size="small"
                danger
                disabled={readItems.length === 0}
                onClick={() => setConfirmDelete(true)}>
                {labels.centerDeleteRead}
              </Button>
              {settingsEntry !== undefined && settingsEntry !== null && onOpenSettings !== undefined ? (
                <Button
                  size="small"
                  data-notification-open-settings
                  onClick={() => onOpenSettings(settingsEntry)}>
                  {labels.centerOpenSettings}
                </Button>
              ) : null}
            </>
          )}
        </div>
      }>
      <div id={NOTIFICATION_CENTER_PANEL_ID} data-notification-center-panel>
      {notice === null ? null : (
        <p className="notification-center-notice" role="status">
          {notice}
        </p>
      )}
      {state === 'loading' && items.length === 0 ? (
        // 首次进入只画加载中：数据回来之前既不算「没有」，也不算「读不到」。
        <LoadingState ariaLabel={labels.centerTitle} />
      ) : items.length > 0 ? (
        <>
          {state === 'error' ? (
            // 刷新失败但手上有上一次的列表：**不拿它换一块空白**，只标一句「这是上次的读数」。
            <p className="notification-center-stale" role="status" data-center-stale>
              <span>{labels.centerStaleNotice}</span>
              {/* 句内动作：命令型一律 antd；`.text-action` 是「行内动作」的标记，旧的排印类保留不改外观。 */}
              <Button type="text" size="small" className="notification-center-link text-action" onClick={() => void load()}>
                {labels.centerReload}
              </Button>
            </p>
          ) : null}
          <NotificationGroups
            labels={labels}
            onOpenDeeplink={onOpenDeeplink}
            onOpenExternal={onOpenExternal}
            onRead={markOneRead}
            readItems={readItems}
            recorded={recorded}
            unreadItems={unreadItems}
          />
        </>
      ) : state === 'error' ? (
        // 「读取失败」：知道要重试。原因码与未知态**必须不同**，两屏只靠原因句区分。
        <StateView state="error" reasonCode="unreadable" size="md" action={{ labelKey: 'ui.state.action.retry', onSelect: () => void load() }} />
      ) : state === 'unknown' ? (
        <>
          <StateView
            state="error"
            reasonCode="notification-unknown"
            size="md"
            action={{ labelKey: 'ui.state.action.retry', onSelect: () => void load() }}
          />
          {/* 底部两个批量动作这时是禁用的，原因写在这里一次：否则读者只看到两个灰按钮。 */}
          <p className="notification-center-empty-hint" role="note" data-center-unknown-hint>
            {labels.centerUnknownHint}
          </p>
        </>
      ) : (
        <>
          <StateView state="empty" reasonCode="not-yet" size="md" />
          {/* 通用空态句说不出「等的是谁」：这个页面的来源是外部事件，所以下面补一句本页专属的说明。
              放在 `StateView` 之外，是因为改了平台键会让另外七处 `not-yet` 开始说别人的话。 */}
          <p className="notification-center-empty-hint">{labels.centerEmptyHint}</p>
        </>
      )}
      </div>
    </Drawer>
  )
}

function NotificationGroups(props: {
  labels: PlatformText['notifications']
  onOpenDeeplink: (deeplink: NotificationDeeplink) => void
  onOpenExternal: (url: string) => void
  onRead: (id: string) => Promise<void>
  unreadItems: readonly NotificationCenterItem[]
  readItems: readonly NotificationCenterItem[]
  recorded: readonly NotificationCenterItem[]
}): React.ReactElement {
  const { labels, onOpenDeeplink, onOpenExternal, onRead } = props
  return (
    <div className="notification-center-groups">
      {props.unreadItems.length === 0 ? null : (
        <Group
          title={labels.centerUnreadGroup}
          items={props.unreadItems}
          labels={labels}
          onOpenDeeplink={onOpenDeeplink}
          onOpenExternal={onOpenExternal}
          onRead={onRead}
          actionable
        />
      )}
      {props.readItems.length === 0 ? null : (
        <Group
          title={labels.centerEarlierGroup}
          items={props.readItems}
          labels={labels}
          onOpenDeeplink={onOpenDeeplink}
          onOpenExternal={onOpenExternal}
          onRead={onRead}
          actionable
        />
      )}
      {props.recorded.length === 0 ? null : (
        <Group
          title={labels.centerRecordedGroup}
          items={props.recorded}
          labels={labels}
          onOpenDeeplink={onOpenDeeplink}
          onOpenExternal={onOpenExternal}
          onRead={onRead}
        />
      )}
    </div>
  )
}

function Group(props: {
  title: string
  items: readonly NotificationCenterItem[]
  labels: PlatformText['notifications']
  onRead: (id: string) => Promise<void>
  onOpenDeeplink: (deeplink: NotificationDeeplink) => void
  onOpenExternal: (url: string) => void
  /** 主位才给动作；「仅记录」组没有动作目标，行上不出按钮（A2 只约束主位，A3 管这里）。 */
  actionable?: boolean
}): React.ReactElement {
  return (
    <section className="notification-center-group">
      <h3 className="notification-center-group-title">{props.title}</h3>
      <ul className="notification-center-list">
        {props.items.map((item) => (
          <NotificationRow
            actionable={props.actionable === true}
            item={item}
            key={item.id}
            labels={props.labels}
            onOpenDeeplink={props.onOpenDeeplink}
            onOpenExternal={props.onOpenExternal}
            onRead={props.onRead}
          />
        ))}
      </ul>
    </section>
  )
}

/** 同事件重复合并的窗口：只有 7 天内的重复才带 `×N`，跨窗口不合并（A4）。 */
export const MERGED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export function mergedCountOf(item: NotificationCenterItem, now: number): number | null {
  if (item.occurrenceCount <= 1) return null
  const created = Date.parse(item.createdAt)
  if (!Number.isFinite(created)) return null
  return now - created <= MERGED_WINDOW_MS ? item.occurrenceCount : null
}

/** 正文超过这个长度才给「展开」：短句被收起反而多一次点击。 */
export const LONG_BODY_CHARS = 90

/**
 * 行标题的 id：动作按钮用 `aria-describedby` 指过来。
 *
 * 为什么需要：主位里一屏可能有好几条都叫「打开任务」「看原文」，读屏逐个 Tab 过去听到的是同一串名字，
 * 分不出是哪一条。**所有动作按钮同一套做法**——不给某一种开特例，否则下一个人只修自己那一颗。
 */
export function rowTitleId(itemId: string): string {
  return `notification-row-title-${itemId}`
}

function NotificationRow(props: {
  item: NotificationCenterItem
  actionable: boolean
  labels: PlatformText['notifications']
  onRead: (id: string) => Promise<void>
  onOpenDeeplink: (deeplink: NotificationDeeplink) => void
  onOpenExternal: (url: string) => void
}): React.ReactElement {
  const { item, labels } = props
  const [expanded, setExpanded] = useState(false)
  // 句子在主进程读的那一刻解析好了：这里没有表可查、没有参数要填、也没有兜底可写。
  const text = { title: item.title, body: item.body }
  const unread = item.state === 'unread'
  const merged = mergedCountOf(item, Date.now())
  const longBody = text.body.length > LONG_BODY_CHARS

  return (
    <li className="notification-center-row" data-state={item.state} key={item.id}>
      <div className="notification-center-copy">
        <strong className="notification-center-title" id={rowTitleId(item.id)} title={text.title}>
          {text.title}
          {merged === null ? null : (
            <span className="notification-center-merged">{labels.centerMergedCount(String(merged))}</span>
          )}
        </strong>
        {text.body ? (
          <span className={expanded ? 'notification-center-body' : 'notification-center-body notification-center-body--clamped'}>
            {text.body}
          </span>
        ) : null}
        {longBody ? (
          <Button
            type="text"
            size="small"
            className="notification-center-link text-action"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}>
            {expanded ? labels.centerCollapse : labels.centerExpand}
          </Button>
        ) : null}
      </div>
      {props.actionable ? (
        <NotificationActionButton
          item={item}
          onOpenDeeplink={props.onOpenDeeplink}
          onOpenExternal={props.onOpenExternal}
          onRead={props.onRead}
        />
      ) : null}
    </li>
  )
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
function NotificationActionButton(props: {
  item: NotificationCenterItem
  onOpenDeeplink: (deeplink: NotificationDeeplink) => void
  onRead: (id: string) => Promise<void>
  onOpenExternal: (url: string) => void
}): React.ReactElement | null {
  const action = props.item.actions[0]
  if (action === undefined) return null
  const external = action.kind === 'open-external' && typeof action.url === 'string' && EXTERNAL_URL.test(action.url)
    ? action.url
    : undefined
  const deeplink = action.deeplink ?? props.item.deeplink
  if (external === undefined && deeplink === undefined) return null
  const label = action.label
  return (
    <Button
      size="small"
      aria-describedby={rowTitleId(props.item.id)}
      onClick={() => {
        // 一次操作两个效果：把人送到地方，同时把这条标成已读。
        // 只送不标的话，回来仍看见同一条未读，角标也不减，等于留了个没人用的钩子。
        if (props.item.state === 'unread') void props.onRead(props.item.id)
        if (external !== undefined) props.onOpenExternal(external)
        else if (deeplink !== undefined) props.onOpenDeeplink(deeplink)
      }}>
      {label}
    </Button>
  )
}

/** 只认「有 items 数组」这一种成功形态：其余一律当作判不出来，不是「没有」。 */
function isNotificationPage(value: unknown): value is { items: NotificationCenterItem[] } {
  return typeof value === 'object' && value !== null && Array.isArray((value as { items?: unknown }).items)
}
