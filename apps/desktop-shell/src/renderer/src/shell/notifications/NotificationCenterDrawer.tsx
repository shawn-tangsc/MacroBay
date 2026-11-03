import { useCallback, useEffect, useState } from 'react'
import { Button } from 'antd'

import { LoadingState } from '@platform/ui/components/loading'
import { StateView } from '@platform/ui/components/state'
import { Drawer } from '@platform/ui/components/drawer'
import { notificationCopy, type NotificationCopyKey, type NotificationCopyLanguage } from '@platform/i18n/notificationCopy'
import type {
  NotificationDeeplink,
  SafeNotificationRecord
} from '@platform/notifications/contracts/notificationContracts'

import type { PlatformText } from '../../i18n/platformText'

import { createNotificationCenterSource, type NotificationCenterSource } from './notificationCenterSource'
import { resolveNotificationText } from './notificationText'

import './notificationCenter.css'

export const CENTER_TITLE_KEY = 'notifications.centerTitle'

type NotificationCenterDrawerProps = {
  open: boolean
  onClose: () => void
  labels: PlatformText['notifications']
  language: NotificationCopyLanguage
  /** 通知自带的动作要真的做那件事：把 deeplink 交给外壳打开，而不是再标一次已读。 */
  onOpenDeeplink: (deeplink: NotificationDeeplink) => void
  source?: NotificationCenterSource
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
  language,
  onOpenDeeplink,
  source
}: NotificationCenterDrawerProps): React.ReactElement {
  const [state, setState] = useState<LoadState>('loading')
  const [items, setItems] = useState<readonly SafeNotificationRecord[]>([])
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

  // 有目标可去的通知才进主位；没有动作目标的只留记录，不占主位（A3）。
  const actionables = items.filter((item) => item.deeplink !== undefined)
  const recorded = items.filter((item) => item.deeplink === undefined)
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
            </>
          )}
        </div>
      }>
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
              <button type="button" className="notification-center-link" onClick={() => void load()}>
                {labels.centerReload}
              </button>
            </p>
          ) : null}
          <NotificationGroups
            labels={labels}
            language={language}
            onOpenDeeplink={onOpenDeeplink}
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
    </Drawer>
  )
}

function NotificationGroups(props: {
  labels: PlatformText['notifications']
  language: NotificationCopyLanguage
  onOpenDeeplink: (deeplink: NotificationDeeplink) => void
  onRead: (id: string) => Promise<void>
  unreadItems: readonly SafeNotificationRecord[]
  readItems: readonly SafeNotificationRecord[]
  recorded: readonly SafeNotificationRecord[]
}): React.ReactElement {
  const { labels, language, onOpenDeeplink, onRead } = props
  return (
    <div className="notification-center-groups">
      {props.unreadItems.length === 0 ? null : (
        <Group
          title={labels.centerUnreadGroup}
          items={props.unreadItems}
          language={language}
          labels={labels}
          onOpenDeeplink={onOpenDeeplink}
          onRead={onRead}
          actionable
        />
      )}
      {props.readItems.length === 0 ? null : (
        <Group
          title={labels.centerEarlierGroup}
          items={props.readItems}
          language={language}
          labels={labels}
          onOpenDeeplink={onOpenDeeplink}
          onRead={onRead}
          actionable
        />
      )}
      {props.recorded.length === 0 ? null : (
        <Group
          title={labels.centerRecordedGroup}
          items={props.recorded}
          language={language}
          labels={labels}
          onOpenDeeplink={onOpenDeeplink}
          onRead={onRead}
        />
      )}
    </div>
  )
}

function Group(props: {
  title: string
  items: readonly SafeNotificationRecord[]
  language: NotificationCopyLanguage
  labels: PlatformText['notifications']
  onRead: (id: string) => Promise<void>
  onOpenDeeplink: (deeplink: NotificationDeeplink) => void
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
            language={props.language}
            onOpenDeeplink={props.onOpenDeeplink}
            onRead={props.onRead}
          />
        ))}
      </ul>
    </section>
  )
}

/** 同事件重复合并的窗口：只有 7 天内的重复才带 `×N`，跨窗口不合并（A4）。 */
export const MERGED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export function mergedCountOf(item: SafeNotificationRecord, now: number): number | null {
  if (item.occurrenceCount <= 1) return null
  const created = Date.parse(item.createdAt)
  if (!Number.isFinite(created)) return null
  return now - created <= MERGED_WINDOW_MS ? item.occurrenceCount : null
}

/** 正文超过这个长度才给「展开」：短句被收起反而多一次点击。 */
export const LONG_BODY_CHARS = 90

function NotificationRow(props: {
  item: SafeNotificationRecord
  actionable: boolean
  language: NotificationCopyLanguage
  labels: PlatformText['notifications']
  onRead: (id: string) => Promise<void>
  onOpenDeeplink: (deeplink: NotificationDeeplink) => void
}): React.ReactElement {
  const { item, labels, language } = props
  const [expanded, setExpanded] = useState(false)
  const text = resolveNotificationText(item, language)
  const unread = item.state === 'unread'
  const merged = mergedCountOf(item, Date.now())
  const longBody = text.body.length > LONG_BODY_CHARS

  return (
    <li className="notification-center-row" data-state={item.state} key={item.id}>
      <div className="notification-center-copy">
        <strong className="notification-center-title" title={text.title}>
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
        {item.delivery.push?.state === 'failed' ? (
          // 通道失败**不新增条目**：在原条目 meta 里加一句，用危险色；成功则什么都不加。
          <span className="notification-center-push-failed" role="note" data-push-failed>
            {labels.centerPushFailed(item.delivery.push.reason ?? '')}
          </span>
        ) : null}
        {item.delivery.desktop?.state === 'sent-accepted' ? (
          // 交给系统了不等于读者看到了：只写「未确认显示」，不写「已显示」。
          <span className="notification-center-unconfirmed" data-unconfirmed>
            {labels.centerUnconfirmed}
          </span>
        ) : null}
        {longBody ? (
          <button
            type="button"
            className="notification-center-link"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}>
            {expanded ? labels.centerCollapse : labels.centerExpand}
          </button>
        ) : null}
      </div>
      {props.actionable ? (
        <NotificationActionButton
          item={item}
          language={language}
          onOpenDeeplink={props.onOpenDeeplink}
          onRead={props.onRead}
        />
      ) : null}
    </li>
  )
}

/** 通知自带动作的文案解析：标签同样只存键，句子按当前语言取。 */
function actionLabel(labelKey: string, language: NotificationCopyLanguage): string {
  return notificationCopy[language][labelKey as NotificationCopyKey] ?? labelKey
}

/**
 * 主位行上的动作 = **这条通知要你做的事**，不是列表管理。
 *
 * 之前这里放的是「标为已读」——那是「我看过了」，不是「任务失败了你去看一眼」。记录里本来就有
 * `actions[0]`（如「打开任务」）与 `deeplink`，UI 不消费它，用户就只能点标记已读，事没做。
 * 现在点击真的把 deeplink 交给外壳打开；没有动作的通知本来就不会进主位。
 */
function NotificationActionButton(props: {
  item: SafeNotificationRecord
  language: NotificationCopyLanguage
  onOpenDeeplink: (deeplink: NotificationDeeplink) => void
  onRead: (id: string) => Promise<void>
}): React.ReactElement | null {
  const action = props.item.actions[0]
  const deeplink = action?.deeplink ?? props.item.deeplink
  if (action === undefined || deeplink === undefined) return null
  const label = actionLabel(action.labelKey, props.language)
  return (
    <Button
      size="small"
      onClick={() => {
        // 一次操作两个效果：把人送到地方，同时把这条标成已读。
        // 只送不标的话，回来仍看见同一条未读，角标也不减，等于留了个没人用的钩子。
        if (props.item.state === 'unread') void props.onRead(props.item.id)
        props.onOpenDeeplink(deeplink)
      }}>
      {label}
    </Button>
  )
}

/** 只认「有 items 数组」这一种成功形态：其余一律当作判不出来，不是「没有」。 */
function isNotificationPage(value: unknown): value is { items: SafeNotificationRecord[] } {
  return typeof value === 'object' && value !== null && Array.isArray((value as { items?: unknown }).items)
}
