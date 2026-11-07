import { useMemo, useState } from 'react'

import { Info } from 'lucide-react'
import { Switch } from 'antd'

import { IconButton } from '@platform/ui/components/icon-button'
import { LoadingState } from '@platform/ui/components/loading'
import { Popover } from '@platform/ui/components/popover'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { CALENDAR_REMINDER_LEAD_MINUTES, type CalendarReminderLeadMinutes } from '../../../contracts/calendarEventReminder'
import { intelligenceNotificationText } from './text'
import { useCalendarReminderSettings, type CalendarReminderSettingsState } from './useCalendarReminderSettings'
import { INTELLIGENCE_CHANNEL_EVENT_ROWS, useChannelEventSettings } from './useChannelEventSettings'
import { useNewsPushOutletSwitch } from './useNewsPushOutletSwitch'
import { useNotificationLayout } from './useNarrowWindow'
import { useSurfaceSelection } from './useSurfaceSelection'

import './intelligence-notification.css'

/**
 * 设置 → 情报 → 通知（界面规范 v2.39 §9d–§9f）：左边四项、右边详情。
 *
 * 前三条管「哪些情报内容推手机」；**「日历事件」一项管同一个事件在时间上的前后两段**
 * （开始前提醒 / 发生后通知）——同一功能的两段不许多占两个列表项，用时间线 + 段标题表达。
 *
 * 页面**只读服务结果**：三层「与」（批准表 ∩ 总开关 ∩ 这一处选择）由平台算，这里只负责画。
 */

type ItemKey = 'signal' | 'briefing' | 'sentiment' | 'calendar'

const ITEM_KEYS: readonly ItemKey[] = ['signal', 'briefing', 'sentiment', 'calendar']

/** 三条内容项各自的开关与文案键；顺序与列表一致。 */
const CONTENT_ITEMS: Readonly<Record<'signal' | 'briefing' | 'sentiment', { eventId: string; row: string }>> = {
  signal: { eventId: INTELLIGENCE_CHANNEL_EVENT_ROWS[0]!.eventId, row: 'signalTriggered' },
  briefing: { eventId: INTELLIGENCE_CHANNEL_EVENT_ROWS[2]!.eventId, row: 'briefingReady' },
  sentiment: { eventId: INTELLIGENCE_CHANNEL_EVENT_ROWS[1]!.eventId, row: 'sentimentAlert' }
}

const CALENDAR_GROUP_EVENT_ID = 'market-intelligence.calendar.event-upcoming'

/**
 * 从通知中心点「去设置」进来时，壳层把目标 id 放在 `focusEntityId`（与运行日志页同一种传法）。
 * 能定位就落到那条通知对应的一项；定位不到落第一项——**不猜**，也不留在上一页的位置上。
 */
function itemForFocus(focusEntityId: string | null | undefined): ItemKey {
  if (!focusEntityId) return 'signal'
  if (
    focusEntityId.startsWith('market-intelligence.calendar.')
    || focusEntityId === 'market-intelligence.macro.event-landed'
  ) {
    return 'calendar'
  }
  if (focusEntityId === CONTENT_ITEMS.signal.eventId) return 'signal'
  if (focusEntityId === CONTENT_ITEMS.briefing.eventId) return 'briefing'
  if (focusEntityId === CONTENT_ITEMS.sentiment.eventId) return 'sentiment'
  return 'signal'
}

export default function IntelligenceNotificationSettingsSection(
  { focusEntityId }: Readonly<{ focusEntityId?: string | null }> = {}
): React.ReactElement {
  const language = useShellLanguage()
  const text = intelligenceNotificationText[language]
  const resolveText = (key: string): string => text[key] ?? ''
  const { status, values, savingEventId, failedEventId, channelReady, reload, toggle } = useChannelEventSettings()
  const outlet = useNewsPushOutletSwitch()
  const reminder = useCalendarReminderSettings()
  const surfaces = useSurfaceSelection(CALENDAR_GROUP_EVENT_ID)
  // 初始项由入口决定：从「去设置」进来落到对应那一项，定位不到落第一项。
  const [selected, setSelected] = useState<ItemKey>(() => itemForFocus(focusEntityId))
  // 量的是这一页自己的宽度：三列布局里窗口宽不等于这一页宽，按窗口判会继续挤压。
  const { setSectionRef, layout } = useNotificationLayout()
  const narrow = layout.mode === 'dropdown'

  const itemName = (key: ItemKey): string =>
    text[`pages.intelligence.notification.rows.${key === 'calendar' ? 'calendar' : CONTENT_ITEMS[key].row}.title`] ?? ''

  const itemState = (key: ItemKey): string => {
    if (key === 'calendar') {
      // 还在读的时候不是「读不到」：那会把一次正常的加载说成故障。
      if (reminder.status === 'loading') return text['pages.intelligence.notification.status.loading'] ?? ''
      if (reminder.value === undefined) return text['pages.intelligence.notification.status.unreadable'] ?? ''
      return reminder.value.enabled
        ? (text['pages.intelligence.notification.status.calendarOn'] ?? '').replace(
          '{lead}',
          text[`pages.intelligence.notification.leads.${reminder.value.leadMinutes}`] ?? ''
        )
        : text['pages.intelligence.notification.status.off'] ?? ''
    }
    const enabled = key === 'sentiment' ? outlet.enabled : values[CONTENT_ITEMS[key].eventId] ?? true
    return enabled ? text['pages.intelligence.notification.status.on'] ?? '' : text['pages.intelligence.notification.status.off'] ?? ''
  }

  if (status === 'loading') {
    return (
      <section className="settings-workspace intelligence-notification-workspace" aria-busy="true" ref={setSectionRef}>
        <LoadingState ariaLabel={text['pages.intelligence.notification.groupTitle'] ?? ''} />
      </section>
    )
  }
  if (status === 'error') {
    return (
      <section className="settings-workspace intelligence-notification-workspace">
        <StateView
          state="error"
          reasonCode="unreadable"
          action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: reload }}
        />
      </section>
    )
  }

  return (
    <section className="settings-workspace intelligence-notification-workspace" ref={setSectionRef}>
      {/* 结构写死：DOM 顺序 = 视觉顺序。标题行在网格之外；网格里**恰好两个**子元素。
          上一版三个子元素塞进两列网格，自动排布把标题放窄格、详情挤到第二行——这就是那次崩坏。 */}
      <div className="intelligence-notification-master-detail">
        {/* 整页的说明收进 ⓘ：它不是操作也不是状态，正文只留字段名、当前值与控件。 */}
        <div className="intelligence-notification-list-head">
          <h2 className="intelligence-notification-title">{text['pages.intelligence.notification.groupTitle']}</h2>
          {/* 只留一句：它回答的是「勾了为什么不响」（批准 / 频道 / 开关三道），
              而不是再复述一遍「其余通知去哪」。两句叠在一起读者要读两遍才懂。 */}
          <Popover
            labelKey="pages.intelligence.notification.groupInfo.2"
            resolveText={resolveText}
            trigger={(triggerProps) => (
              <IconButton
                {...triggerProps}
                ariaLabelKey="pages.intelligence.notification.infoAria"
                icon={Info}
                size="sm"
                variant="plain"
                resolveText={resolveText}
              />
            )}
          />
        </div>

        <div className="intelligence-notification-panes">
        {/* 窄窗：列表收成顶部下拉，**名字与状态都进选项文本**——图标认不出是哪一条。 */}
        {narrow
          ? <div className="intelligence-notification-narrow">
            <label className="intelligence-notification-narrow-label">
              {text['pages.intelligence.notification.groupTitle']}
              <select
                aria-label={text['pages.intelligence.notification.groupTitle']}
                onChange={(event) => setSelected(event.target.value as ItemKey)}
                value={selected}
              >
                {ITEM_KEYS.map((key) => (
                  <option key={key} value={key}>{`${itemName(key)} · ${itemState(key)}`}</option>
                ))}
              </select>
            </label>
          </div>
          : <ul className="intelligence-notification-list" aria-label={text['pages.intelligence.notification.groupTitle']}>
            {ITEM_KEYS.map((key) => (
              <li key={key}>
                <button
                  aria-current={selected === key ? 'true' : undefined}
                  className="intelligence-notification-list-item"
                  onClick={() => setSelected(key)}
                  type="button"
                >
                  <span className="intelligence-notification-list-name" title={itemName(key)}>{itemName(key)}</span>
                  <span className="intelligence-notification-list-state" title={itemState(key)}>{itemState(key)}</span>
                </button>
              </li>
            ))}
          </ul>}

        <div className="intelligence-notification-detail">
          <div className="intelligence-notification-detail-head">
            <h2 className="intelligence-notification-title">{itemName(selected)}</h2>
            <Popover
              lines={[{ labelKey: `pages.intelligence.notification.rows.${selected === 'calendar' ? 'calendar' : CONTENT_ITEMS[selected].row}.info` }]}
              resolveText={resolveText}
              trigger={(triggerProps) => (
                <IconButton
                  {...triggerProps}
                  ariaLabelKey="pages.intelligence.notification.rowInfoAria"
                  icon={Info}
                  size="sm"
                  variant="plain"
                  resolveText={resolveText}
                />
              )}
            />
          </div>

          {selected === 'calendar'
            ? <CalendarDetail reminder={reminder} resolveText={resolveText} surfaces={surfaces} text={text} />
            : selected === 'sentiment'
              ? <RowSwitch
                enabled={outlet.enabled}
                failed={outlet.saveFailed}
                name={itemName('sentiment')}
                onChange={outlet.setEnabled}
                saving={outlet.saving}
                text={text}
              />
              : <RowSwitch
                enabled={values[CONTENT_ITEMS[selected].eventId] ?? true}
                failed={failedEventId === CONTENT_ITEMS[selected].eventId}
                name={itemName(selected)}
                onChange={(next) => toggle(CONTENT_ITEMS[selected].eventId, next)}
                saving={savingEventId === CONTENT_ITEMS[selected].eventId}
                text={text}
              />}

          {channelReady ? null : (
            <p className="intelligence-notification-hint" role="status">
              {text['pages.intelligence.notification.channelNotReady']}
            </p>
          )}
        </div>
        </div>
      </div>
    </section>
  )
}

function RowSwitch(props: {
  enabled: boolean
  saving: boolean
  failed: boolean
  name: string
  onChange: (enabled: boolean) => void
  text: Readonly<Record<string, string>>
}): React.ReactElement {
  return <div className="intelligence-notification-row">
    <span className="intelligence-notification-row-title">{props.name}</span>
    <Switch
      aria-label={props.name}
      checked={props.enabled}
      disabled={props.saving}
      loading={props.saving}
      onChange={props.onChange}
    />
    {props.failed
      ? <span className="intelligence-notification-save-failed" role="status">
        {props.text['pages.intelligence.notification.saveFailed']}
      </span>
      : null}
  </div>
}

type SurfaceState = ReturnType<typeof useSurfaceSelection>

function CalendarDetail(props: {
  reminder: CalendarReminderSettingsState
  surfaces: SurfaceState
  text: Readonly<Record<string, string>>
  resolveText: (key: string) => string
}): React.ReactElement {
  const { reminder, surfaces, text } = props
  const leadChoices = useMemo(() => CALENDAR_REMINDER_LEAD_MINUTES, [])

  // **加载中先画加载**：以前这里把「还没读到」当成「读不到」，用户一进页面就看到「读取失败」。
  if (reminder.status === 'loading') {
    return <LoadingState ariaLabel={text['pages.intelligence.notification.groupTitle'] ?? ''} />
  }
  if (reminder.status === 'error' || reminder.value === undefined) {
    return <StateView
      state="error"
      reasonCode="unreadable"
      action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: reminder.reload }}
    />
  }
  const value = reminder.value
  const lead = (minutes: CalendarReminderLeadMinutes): string =>
    text[`pages.intelligence.notification.leads.${minutes}`] ?? `${minutes}`

  return <div className="intelligence-notification-calendar">
    <div className="intelligence-notification-line">
      <p className="intelligence-notification-timeline">{text['pages.intelligence.notification.calendar.timeline']}</p>
      <Popover
        lines={[
          { labelKey: 'pages.intelligence.notification.calendar.types' },
          { labelKey: 'pages.intelligence.notification.calendar.leadNote' }
        ]}
        resolveText={props.resolveText}
        trigger={(triggerProps) => (
          <IconButton
            {...triggerProps}
            ariaLabelKey="pages.intelligence.notification.calendar.aboutAria"
            icon={Info}
            size="sm"
            variant="plain"
            resolveText={props.resolveText}
          />
        )}
      />
    </div>

    {/* 一处选择管两条：开始前与发生后共用这一层（契约 §5.5）。 */}
    <section className="intelligence-notification-block">
      <div className="intelligence-notification-line">
        <h3>{text['pages.intelligence.notification.calendar.surfaces']}</h3>
        <Popover
          labelKey="pages.intelligence.notification.calendar.surfacesNote"
          resolveText={props.resolveText}
          trigger={(triggerProps) => (
            <IconButton
              {...triggerProps}
              ariaLabelKey="pages.intelligence.notification.calendar.aboutAria"
              icon={Info}
              size="sm"
              variant="plain"
              resolveText={props.resolveText}
            />
          )}
        />
      </div>
      {surfaces.status === 'error'
        ? <p className="intelligence-notification-hint" role="status">
          {text['pages.intelligence.notification.surfacesUnreadable']}
        </p>
        : surfaces.status === 'loading'
          ? <LoadingState ariaLabel={text['pages.intelligence.notification.calendar.surfaces'] ?? ''} />
          : <>
            {surfaces.conflict
              ? <p className="intelligence-notification-warn" role="status">
                {text['pages.intelligence.notification.surfacesConflict']}
              </p>
              : null}
            {surfaces.available.map((surface) => {
              const checked = surfaces.selection[surface] ?? false
              const blocked = surface === 'toast' && surfaces.toastMasterOff && checked
              return <div className="intelligence-notification-check-row" key={surface}>
                <label className="intelligence-notification-check">
                  <input
                    checked={checked}
                    disabled={surfaces.saving}
                    onChange={() => surfaces.toggle(surface, !checked)}
                    type="checkbox"
                  />
                  {text[`pages.intelligence.notification.surface.${surface}`] ?? surface}
                </label>
                {/* 勾了却不会响：当场说清（「不许点了没反应」的同一件事），勾选框本身不灰。 */}
                {blocked
                  ? <span className="intelligence-notification-warn" role="status">
                    {text[`pages.intelligence.notification.surfaceBlocked.${surface}`]}
                  </span>
                  : null}
              </div>
            })}
          </>}
    </section>

    <section className="intelligence-notification-block">
      <h3>{text['pages.intelligence.notification.calendar.before']}</h3>
      <label className="intelligence-notification-check">
        <input
          checked={value.enabled}
          disabled={reminder.saving}
          onChange={() => reminder.update({ enabled: !value.enabled })}
          type="checkbox"
        />
        {text['pages.intelligence.notification.calendar.beforeRow']}
      </label>
      {value.enabled
        ? <>
          <fieldset className="intelligence-notification-fieldset">
            <legend>{text['pages.intelligence.notification.calendar.lead']}</legend>
            {leadChoices.map((minutes) => (
              <label className="intelligence-notification-check" key={minutes}>
                <input
                  checked={value.leadMinutes === minutes}
                  disabled={reminder.saving}
                  name="calendar-reminder-lead"
                  onChange={() => reminder.update({ leadMinutes: minutes })}
                  type="radio"
                />
                {lead(minutes)}
              </label>
            ))}
          </fieldset>
          <fieldset className="intelligence-notification-fieldset">
            <legend>{text['pages.intelligence.notification.calendar.importance']}</legend>
            {(['high', 'medium', 'low'] as const).map((level) => (
              <label className="intelligence-notification-check" key={level}>
                <input
                  checked={value.importance.includes(level)}
                  disabled={reminder.saving}
                  onChange={() => reminder.update({
                    importance: value.importance.includes(level)
                      ? value.importance.filter((entry) => entry !== level)
                      : [...value.importance, level]
                  })}
                  type="checkbox"
                />
                {text[`pages.intelligence.notification.importance.${level}`] ?? level}
              </label>
            ))}
          </fieldset>
        </>
        : <p className="intelligence-notification-note">
          {(text['pages.intelligence.notification.calendar.summary'] ?? '')
            .replace('{lead}', lead(value.leadMinutes))
            .replace(
              '{importance}',
              value.importance
                .map((level) => text[`pages.intelligence.notification.importance.${level}`] ?? level)
                .join(text['pages.intelligence.notification.joiner'] ?? ' / ')
            )}
        </p>}
      {reminder.saveFailed
        ? <p className="intelligence-notification-save-failed" role="status">
          {text['pages.intelligence.notification.saveFailed']}
        </p>
        : null}
    </section>

    <section className="intelligence-notification-block">
      <div className="intelligence-notification-line">
        <h3>{text['pages.intelligence.notification.calendar.after']}</h3>
        <Popover
          labelKey="pages.intelligence.notification.landed.note"
          resolveText={props.resolveText}
          trigger={(triggerProps) => (
            <IconButton
              {...triggerProps}
              ariaLabelKey="pages.intelligence.notification.calendar.aboutAria"
              icon={Info}
              size="sm"
              variant="plain"
              resolveText={props.resolveText}
            />
          )}
        />
      </div>
      {(['surprise-only', 'also-matched'] as const).map((filter) => (
        <label className="intelligence-notification-check" key={filter}>
          <input
            checked={value.landedFilter === filter}
            disabled={reminder.saving}
            name="calendar-landed-filter"
            onChange={() => reminder.update({ landedFilter: filter })}
            type="radio"
          />
          {text[`pages.intelligence.notification.landed.${filter}`] ?? filter}
        </label>
      ))}
      {/* 代价只在被选中时出现：常态不需要免责声明。 */}
      {value.landedFilter === 'also-matched'
        ? <p className="intelligence-notification-warn" role="status">
          {text['pages.intelligence.notification.landed.cost']}
        </p>
        : null}
    </section>
  </div>
}
