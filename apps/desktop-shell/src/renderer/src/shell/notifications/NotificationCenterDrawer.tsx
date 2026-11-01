import { useCallback, useEffect, useState } from 'react'
import { Button } from 'antd'

import { LoadingState } from '@platform/ui/components/loading'
import { StateView } from '@platform/ui/components/state'
import { Drawer } from '@platform/ui/components/drawer'
import { notificationCopy, type NotificationCopyLanguage, type NotificationCopyKey } from '@platform/i18n/notificationCopy'
import type { SafeNotificationRecord } from '@platform/notifications/contracts/notificationContracts'

import type { PlatformText } from '../../i18n/platformText'

import { createNotificationCenterSource, type NotificationCenterSource } from './notificationCenterSource'

export const CENTER_TITLE_KEY = 'notifications.centerTitle'

type NotificationCenterDrawerProps = {
  open: boolean
  onClose: () => void
  labels: PlatformText['notifications']
  language: NotificationCopyLanguage
  source?: NotificationCenterSource
}

type LoadState = 'loading' | 'ready' | 'error'

/** 记录里存的是键 + 参数，句子在这里按当前语言解析：切了语言，历史通知也跟着变。 */
export function resolveNotificationText(
  record: SafeNotificationRecord,
  language: NotificationCopyLanguage
): { title: string; body: string } {
  const table = notificationCopy[language]
  const fill = (template: string, params?: Readonly<Record<string, string>>): string =>
    params === undefined
      ? template
      : template.replace(/\{(\w+)\}/g, (whole, name: string) =>
          Object.prototype.hasOwnProperty.call(params, name) ? params[name]! : whole
        )
  const title = table[record.titleKey as NotificationCopyKey] ?? record.titleKey
  const body = record.bodyKey === undefined ? '' : table[record.bodyKey as NotificationCopyKey] ?? record.bodyKey
  return { title: fill(title, record.titleParams), body: fill(body, record.bodyParams) }
}

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
      className="notification-center-drawer"
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
      {state === 'loading' ? (
        <LoadingState ariaLabel={labels.centerTitle} />
      ) : state === 'error' ? (
        <StateView state="error" reasonCode="unreadable" size="md" action={{ labelKey: 'ui.state.action.retry', onSelect: () => void load() }} />
      ) : items.length === 0 ? (
        <StateView state="empty" reasonCode="not-yet" size="md" />
      ) : (
        <div className="notification-center-groups">
          {unreadItems.length === 0 ? null : (
            <Group title={labels.centerUnreadGroup} items={unreadItems} language={language} labels={labels} onRead={markOneRead} actionable />
          )}
          {readItems.length === 0 ? null : (
            <Group title={labels.centerEarlierGroup} items={readItems} language={language} labels={labels} onRead={markOneRead} actionable />
          )}
          {recorded.length === 0 ? null : (
            <Group title={labels.centerRecordedGroup} items={recorded} language={language} labels={labels} onRead={markOneRead} />
          )}
        </div>
      )}
    </Drawer>
  )
}

function Group(props: {
  title: string
  items: readonly SafeNotificationRecord[]
  language: NotificationCopyLanguage
  labels: PlatformText['notifications']
  onRead: (id: string) => Promise<void>
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
        <Button
          size="small"
          disabled={!unread}
          aria-label={labels.centerMarkRead}
          onClick={() => void props.onRead(item.id)}>
          {labels.centerMarkRead}
        </Button>
      ) : null}
    </li>
  )
}
