import { useState, type ReactElement, type ReactNode } from 'react'

import { LoadingState } from '@platform/ui/components/loading'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import type { SettingDescriptor } from '../../shared/settings/descriptorTypes'
import { settingRegistry } from '../../shared/settings/registry'
import { intelligenceNotificationText } from './text'
import { CalendarDetail } from './calendarDetail'
import { ContentDetail } from './contentDetail'
import { NewsPushThresholdRow } from './newsPushThresholdRow'
import { NotificationList, type NotificationListItem } from './notificationList'
import { SettingsInfo } from './settingsRow'
import { useCalendarReminderSettings } from './useCalendarReminderSettings'
import { INTELLIGENCE_CHANNEL_EVENT_ROWS, useChannelEventSettings } from './useChannelEventSettings'
import { useNewsPushOutletSwitch } from './useNewsPushOutletSwitch'
import { useNewsPushThreshold } from './useNewsPushThreshold'
import { useNotificationLayout } from './useNarrowWindow'
import { useSurfaceSelection } from './useSurfaceSelection'
import { TestNotificationButton } from './testNotificationButton'

import './intelligence-notification.css'

/**
 * 设置 → 情报 → 通知的**整块内容**：设置页与产品内「配置」抽屉共用同一块实现。
 *
 * 为什么抽出来：抽屉里那一屏要和设置页长得一模一样（用户 2026-11-10「现成的挪进去」），
 * 而抽屉目录不许 import 数据层——所以由宿主渲染本组件，把整块当节点交给抽屉。
 *
 * 两个面只差**外壳**，不差内容：
 * - `page`：原样保留设置页的 `<section class="settings-workspace intelligence-notification-workspace">`
 *   与页标题（页面需要它，且断点量的是这一块的宽度）；
 * - `drawer`：只画内容，标题与页边距归抽屉（不做嵌套标题）。
 */

type ItemKey = (typeof INTELLIGENCE_CHANNEL_EVENT_ROWS)[number]['itemKey']

const ITEM_KEYS: readonly ItemKey[] = INTELLIGENCE_CHANNEL_EVENT_ROWS.map((row) => row.itemKey)

const ROW_BY_ITEM = Object.fromEntries(
  INTELLIGENCE_CHANNEL_EVENT_ROWS.map((row) => [row.itemKey, row])
) as Readonly<Record<ItemKey, (typeof INTELLIGENCE_CHANNEL_EVENT_ROWS)[number]>>

const CALENDAR_GROUP_EVENT_ID = 'market-intelligence.calendar.event-upcoming'

/** 三条内容项各自对应哪一条声明：页面不自己拼字段，只按 key 找声明。 */
const CONTENT_SETTING_KEYS = {
  signal: 'setting:notifications.channel-event.signal-triggered',
  briefing: 'setting:notifications.channel-event.briefing-ready',
  sentiment: 'setting:notifications.push-outlet'
} as const satisfies Record<Exclude<ItemKey, 'calendar'>, string>

/** 日历详情里已迁移的四行（日历开关 / 提前量 / 重要性 / 落地筛选）。 */
const CALENDAR_SETTING_KEYS = [
  'setting:notifications.surfaces',
  'setting:notifications.calendar.enabled',
  'setting:notifications.calendar.lead',
  'setting:notifications.calendar.importance',
  'setting:notifications.calendar.landed-filter',
  'setting:notifications.calendar.landed-countries.scope',
  'setting:notifications.calendar.landed-countries.codes'
] as const

/** 已迁移到「按声明渲染」的键：守卫①②只认这份清单，不按文件位置推断。 */
export const MIGRATED_SETTING_KEYS: readonly string[] = [
  ...Object.values(CONTENT_SETTING_KEYS),
  // 强度门槛是舆情详情里的第二行，不属于列表项本身，单独列在这里。
  'setting:notifications.push-threshold',
  ...CALENDAR_SETTING_KEYS
]

function contentDescriptor(key: Exclude<ItemKey, 'calendar'>): SettingDescriptor {
  const descriptor = settingRegistry.notifications.find((row) => row.key === CONTENT_SETTING_KEYS[key])
  // 没有兜底：声明缺失就是编译/测试的红，不许静默少一行。
  if (!descriptor) throw new Error(`missing setting descriptor: ${CONTENT_SETTING_KEYS[key]}`)
  return descriptor
}

/** 从通知中心点「去设置」进来时落到对应那一项；定位不到落第一项，不猜。 */
export function itemForFocus(focusEntityId: string | null | undefined): ItemKey {
  if (!focusEntityId) return 'signal'
  // 每一行按自己的 id 命中自己：舆情通知必须落到舆情行，不许再借别的行的事件 id。
  const row = INTELLIGENCE_CHANNEL_EVENT_ROWS.find((entry) => entry.eventId === focusEntityId)
  if (row) return row.itemKey
  // 宏观事件与日历「开始前」共用同一组表面选择（`calendar-events`），定位到日历行。
  if (focusEntityId.startsWith('market-intelligence.calendar.')) return 'calendar'
  if (focusEntityId === 'market-intelligence.macro.event-landed') return 'calendar'
  return 'signal'
}

export function NotificationSettingsPanel({ focusEntityId, variant = 'drawer' }: Readonly<{
  /** 从通知中心点「去设置」进来时落到哪一项（只有设置页会传）。 */
  focusEntityId?: string | null
  variant?: 'page' | 'drawer'
}>): ReactElement {
  const language = useShellLanguage()
  const text = intelligenceNotificationText[language]
  const resolveText = (key: string): string => text[key] ?? ''
  const { status, values, savingEventId, failedEventId, channelReady, reload, toggle } = useChannelEventSettings()
  const outlet = useNewsPushOutletSwitch()
  const threshold = useNewsPushThreshold()
  const reminder = useCalendarReminderSettings()
  const surfaces = useSurfaceSelection(CALENDAR_GROUP_EVENT_ID)
  const [selected, setSelected] = useState<ItemKey>(() => itemForFocus(focusEntityId))
  const { setSectionRef, layout } = useNotificationLayout()

  const itemName = (key: ItemKey): string => text[ROW_BY_ITEM[key].titleKey] ?? ''

  /** 状态词只在列表行出现一次（详情标题不重复同一句）。 */
  const itemState = (key: ItemKey): string => {
    if (key === 'calendar') {
      if (reminder.status === 'loading') return text['pages.intelligence.notification.status.loading'] ?? ''
      if (reminder.value === undefined) return text['pages.intelligence.notification.status.unreadable'] ?? ''
      return reminder.value.enabled
        ? (text['pages.intelligence.notification.status.calendarOn'] ?? '').replace(
          '{lead}',
          text[`pages.intelligence.notification.leads.${reminder.value.leadMinutes}`] ?? ''
        )
        : text['pages.intelligence.notification.status.off'] ?? ''
    }
    const row = ROW_BY_ITEM[key]
    const enabled = row.control === 'outlet'
      ? outlet.enabled
      : row.control === 'surface-group'
        ? reminder.value?.enabled === true
        : values[row.eventId] ?? true
    return enabled
      ? text['pages.intelligence.notification.status.on'] ?? ''
      : text['pages.intelligence.notification.status.off'] ?? ''
  }

  const items: readonly NotificationListItem[] = ITEM_KEYS.map((key) => ({
    key,
    name: itemName(key),
    state: itemState(key)
  }))

  /**
   * 宽窄两种形态只属于**设置页**：那一页挂在外壳的三列里，窗口 1280 时它可能只剩 600，所以要量
   * 它自己的宽度，低于 860 换控件。
   *
   * 配置抽屉**固定宽版**：抽屉宽度由壳层决定（恒 `full` = 1040，扣掉菜单 208 与内边距 32 后约 800），
   * 不随读者窗口变——在那里量宽会导致「永远 < 860、永远只有下拉」，读者再也看不到列表。
   */
  const narrow = variant === 'page' && layout.mode === 'dropdown'

  /** 两个面的外壳：设置页保留自己的 section（页面要标题、断点量这一块宽），抽屉只给内容。 */
  const shell = (children: ReactNode, busy = false): ReactElement => variant === 'page'
    ? <section aria-busy={busy ? 'true' : undefined} className="settings-workspace intelligence-notification-workspace" ref={setSectionRef}>{children}</section>
    : <div className="intelligence-notification-panel" data-notification-panel="true">{children}</div>

  if (status === 'loading') {
    return shell(<LoadingState ariaLabel={text['pages.intelligence.notification.groupTitle'] ?? ''} />, true)
  }
  if (status === 'error') {
    return shell(<StateView
      action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: reload }}
      reasonCode="unreadable"
      state="error"
    />)
  }

  return shell(<>
    {/* 标题一行：13.5/600/正常色，上 16 下 12。抽屉自己有这一屏的标题，所以**只在设置页画标题**
        （不做嵌套标题）；那颗 ⓘ 两面都画——它是「为什么勾了还不响」的唯一解释，抽屉马上是唯一入口，
        把解释留在旧页面上等于把答案藏起来。
        抽屉里 ⓘ 紧跟它所解释的这组行（界面设计 2026-11-10：位置一变，读者会以为它解释的是别的东西）。 */}
    <div className={`intelligence-notification-head${variant === 'drawer' ? ' intelligence-notification-head--drawer' : ''}`}>
      {variant === 'page'
        ? <h2 className="intelligence-notification-title">{text['pages.intelligence.notification.groupTitle']}</h2>
        : null}
      <SettingsInfo
        ariaLabelKey="pages.intelligence.notification.infoAria"
        labelKeys={[
          'pages.intelligence.notification.groupInfo.2',
          'pages.intelligence.notification.channelNotReady'
        ]}
        resolveText={resolveText}
      />
    </div>

    <div className="intelligence-notification-panes">
      <NotificationList
        ariaLabel={text['pages.intelligence.notification.groupTitle'] ?? ''}
        items={items}
        narrow={narrow}
        onSelect={(key) => setSelected(key as ItemKey)}
        selected={selected}
      />
      <div className="intelligence-notification-detail">
        {/* 详情标题不再重复列表里的名字：同一个名字写两处，迟早有一处说法不同。 */}
        <div className="intelligence-notification-card">
          {selected === 'calendar'
            ? <CalendarDetail
              landedAction={<TestNotificationButton
                channelReady={channelReady}
                disabled={reminder.value === undefined}
                kind="calendar-landed"
                labelKey="pages.intelligence.notification.test.calendarLanded"
                resolveText={resolveText}
              />}
              reminder={reminder}
              resolveText={resolveText}
              surfaces={surfaces}
              text={text}
              upcomingAction={<TestNotificationButton
                channelReady={channelReady}
                disabled={reminder.value === undefined || !reminder.value.enabled}
                kind="calendar-upcoming"
                labelKey="pages.intelligence.notification.test.calendarUpcoming"
                resolveText={resolveText}
              />}
            />
            : <ContentDetail
              descriptor={contentDescriptor(selected)}
              resolveText={resolveText}
              enabled={ROW_BY_ITEM[selected].control === 'outlet' ? outlet.enabled : values[ROW_BY_ITEM[selected].eventId] ?? true}
              failed={ROW_BY_ITEM[selected].control === 'outlet' ? outlet.saveFailed : failedEventId === ROW_BY_ITEM[selected].eventId}
              onChange={(next) => {
                if (ROW_BY_ITEM[selected].control === 'outlet') outlet.setEnabled(next)
                else toggle(ROW_BY_ITEM[selected].eventId, next)
              }}
              saveFailedText={text['pages.intelligence.notification.saveFailed'] ?? ''}
              saving={ROW_BY_ITEM[selected].control === 'outlet' ? outlet.saving : savingEventId === ROW_BY_ITEM[selected].eventId}
              action={selected === 'sentiment'
                ? <TestNotificationButton
                  channelReady={channelReady}
                  disabled={!(ROW_BY_ITEM[selected].control === 'outlet' ? outlet.enabled : values[ROW_BY_ITEM[selected].eventId] ?? true)}
                  kind="sentiment"
                  labelKey="pages.intelligence.notification.test.sentiment"
                  resolveText={resolveText}
                />
                : undefined}
            >
              {selected === 'sentiment'
                ? <NewsPushThresholdRow
                  last
                  resolveText={resolveText}
                  state={threshold}
                  text={text}
                />
                : null}
            </ContentDetail>}
          {/* 只报**状态**（还没有可用频道）；「勾选会保留、等频道能用时生效」那句解释在标题旁的 ⓘ 里。 */}
          {channelReady ? null : <p className="intelligence-notification-form-note" role="status">
            {text['pages.intelligence.notification.channelNotReadyState']}
          </p>}
        </div>
      </div>
    </div>
  </>)
}
