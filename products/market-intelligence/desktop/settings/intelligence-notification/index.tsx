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
import { useNarrowWindow } from './useNarrowWindow'
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

export default function IntelligenceNotificationSettingsSection(): React.ReactElement {
  const language = useShellLanguage()
  const text = intelligenceNotificationText[language]
  const resolveText = (key: string): string => text[key] ?? ''
  const { status, values, savingEventId, failedEventId, channelReady, reload, toggle } = useChannelEventSettings()
  const outlet = useNewsPushOutletSwitch()
  const reminder = useCalendarReminderSettings()
  const surfaces = useSurfaceSelection(CALENDAR_GROUP_EVENT_ID)
  const [selected, setSelected] = useState<ItemKey>('signal')
  const narrow = useNarrowWindow()

  const itemName = (key: ItemKey): string =>
    text[`pages.intelligence.notification.rows.${key === 'calendar' ? 'calendar' : CONTENT_ITEMS[key].row}.title`] ?? ''

  const itemState = (key: ItemKey): string => {
    if (key === 'calendar') {
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
      <section className="settings-workspace intelligence-notification-workspace" aria-busy="true">
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
    <section className="settings-workspace intelligence-notification-workspace">
      <div className="intelligence-notification-master-detail">
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
                  <span className="intelligence-notification-list-name">{itemName(key)}</span>
                  <span className="intelligence-notification-list-state">{itemState(key)}</span>
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
            ? <CalendarDetail reminder={reminder} surfaces={surfaces} text={text} />
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
      <p className="intelligence-notification-footer">{text['pages.intelligence.notification.footer']}</p>
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
}): React.ReactElement {
  const { reminder, surfaces, text } = props
  const leadChoices = useMemo(() => CALENDAR_REMINDER_LEAD_MINUTES, [])

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
    <p className="intelligence-notification-timeline">{text['pages.intelligence.notification.calendar.timeline']}</p>
    <p className="intelligence-notification-note">{text['pages.intelligence.notification.calendar.types']}</p>

    {/* 一处选择管两条：开始前与发生后共用这一层（契约 §5.5）。 */}
    <section className="intelligence-notification-block">
      <h3>{text['pages.intelligence.notification.calendar.surfaces']}</h3>
      <p className="intelligence-notification-note">{text['pages.intelligence.notification.calendar.surfacesNote']}</p>
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
          <p className="intelligence-notification-note">{text['pages.intelligence.notification.calendar.leadNote']}</p>
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
      <h3>{text['pages.intelligence.notification.calendar.after']}</h3>
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
      <p className="intelligence-notification-note">{text['pages.intelligence.notification.landed.note']}</p>
    </section>
  </div>
}
