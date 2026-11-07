import type { ReactElement } from 'react'

import { Info } from 'lucide-react'
import { Switch } from 'antd'

import { IconButton } from '@platform/ui/components/icon-button'
import { LoadingState } from '@platform/ui/components/loading'
import { Popover } from '@platform/ui/components/popover'
import { Segmented } from '@platform/ui/components/segmented'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'

import { CALENDAR_REMINDER_LEAD_MINUTES } from '../../../contracts/calendarEventReminder'
import { SettingsGroup, SettingsRow } from './settingsRow'
import type { CalendarReminderSettingsState } from './useCalendarReminderSettings'
import type { useSurfaceSelection } from './useSurfaceSelection'

type SurfaceState = ReturnType<typeof useSurfaceSelection>

/**
 * 「日历事件」的详情（界面规范 v1.9 §8 / v2.41 §9f）。
 *
 * 结构固定：**发到哪些地方（整项级，在最上）→ 开始前 → 发生后**。原来自制的
 * 「开始前 —— 事件发生 —— 发生后」那行文字删掉了：两个小节标题本身就说顺序，
 * 那行是装饰、零信息量，还多出一级文字层级。
 */
export function CalendarDetail(props: Readonly<{
  reminder: CalendarReminderSettingsState
  surfaces: SurfaceState
  text: Readonly<Record<string, string>>
  resolveText: (key: string) => string
}>): ReactElement {
  const { reminder, surfaces, text } = props

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
  const lead = (minutes: number): string =>
    text[`pages.intelligence.notification.leads.${minutes}`] ?? `${minutes}`

  return <div className="intelligence-notification-calendar-detail">
    <SettingsGroup
      aside={<Popover
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
      />}
      title={text['pages.intelligence.notification.calendar.surfaces'] ?? ''}
    >
      {surfaces.status === 'error'
        ? <p className="intelligence-notification-form-note" role="status">
          {text['pages.intelligence.notification.surfacesUnreadable']}
        </p>
        : surfaces.status === 'loading'
          ? <LoadingState ariaLabel={text['pages.intelligence.notification.calendar.surfaces'] ?? ''} />
          : <>
            {surfaces.conflict
              ? <p className="intelligence-notification-form-note" role="status">
                {text['pages.intelligence.notification.surfacesConflict']}
              </p>
              : null}
            <div className="intelligence-notification-form-checks" role="group" aria-label={text['pages.intelligence.notification.calendar.surfaces']}>
              {surfaces.available.map((surface) => {
                const checked = surfaces.selection[surface] ?? false
                const blocked = surface === 'toast' && surfaces.toastMasterOff && checked
                return <label className="intelligence-notification-form-check" key={surface}>
                  <input
                    checked={checked}
                    disabled={surfaces.saving}
                    onChange={() => surfaces.toggle(surface, !checked)}
                    type="checkbox"
                  />
                  <span>{text[`pages.intelligence.notification.surface.${surface}`] ?? surface}</span>
                  {/* 勾了却不会响：当场说清（「不许点了没反应」的同一件事），勾选框本身不灰。 */}
                  {blocked
                    ? <span className="intelligence-notification-form-note" role="status">
                      {text[`pages.intelligence.notification.surfaceBlocked.${surface}`]}
                    </span>
                    : null}
                </label>
              })}
            </div>
          </>}
    </SettingsGroup>

    <SettingsGroup title={text['pages.intelligence.notification.calendar.before'] ?? ''}>
      <SettingsRow
        label={text['pages.intelligence.notification.calendar.beforeRow'] ?? ''}
        note={value.enabled
          ? text['pages.intelligence.notification.calendar.leadNote']
          : (text['pages.intelligence.notification.calendar.summary'] ?? '')
            .replace('{lead}', lead(value.leadMinutes))
            .replace(
              '{importance}',
              value.importance
                .map((level) => text[`pages.intelligence.notification.importance.${level}`] ?? level)
                .join(text['pages.intelligence.notification.joiner'] ?? ' / ')
            )}
      >
        <Switch
          aria-label={text['pages.intelligence.notification.calendar.beforeRow'] ?? ''}
          checked={value.enabled}
          disabled={reminder.saving}
          onChange={() => reminder.update({ enabled: !value.enabled })}
        />
      </SettingsRow>
      {/* 提前量与重要性只在开关打开时出现（关着靠收起，不画禁用控件）。 */}
      {value.enabled
        ? <>
          <SettingsRow label={text['pages.intelligence.notification.calendar.lead'] ?? ''}>
            <Segmented
              ariaLabelKey="pages.intelligence.notification.calendar.lead"
              items={CALENDAR_REMINDER_LEAD_MINUTES.map((minutes) => ({
                value: String(minutes),
                labelKey: `pages.intelligence.notification.leads.${minutes}`
              }))}
              onChange={(next) => reminder.update({ leadMinutes: Number(next) as typeof value.leadMinutes })}
              resolveText={props.resolveText}
              value={String(value.leadMinutes)}
            />
          </SettingsRow>
          <SettingsRow label={text['pages.intelligence.notification.calendar.importance'] ?? ''} last>
            <div className="intelligence-notification-form-checks" role="group" aria-label={text['pages.intelligence.notification.calendar.importance']}>
              {(['high', 'medium', 'low'] as const).map((level) => (
                <label className="intelligence-notification-form-check" key={level}>
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
                  <span>{text[`pages.intelligence.notification.importance.${level}`] ?? level}</span>
                </label>
              ))}
            </div>
          </SettingsRow>
        </>
        : null}
      {reminder.saveFailed
        ? <p className="intelligence-notification-form-note" role="status">
          {text['pages.intelligence.notification.saveFailed']}
        </p>
        : null}
    </SettingsGroup>

    <SettingsGroup title={text['pages.intelligence.notification.calendar.after'] ?? ''}>
      <SettingsRow label={text['pages.intelligence.notification.calendar.landedRow'] ?? ''} last>
        <Segmented
          ariaLabelKey="pages.intelligence.notification.calendar.landedRow"
          items={(['surprise-only', 'also-matched'] as const).map((filter) => ({
            value: filter,
            labelKey: `pages.intelligence.notification.landed.${filter}`
          }))}
          onChange={(next) => reminder.update({ landedFilter: next as typeof value.landedFilter })}
          resolveText={props.resolveText}
          value={value.landedFilter}
        />
      </SettingsRow>
      {/* 代价只在被选中时出现，而且留在选择发生的地方——塞进 ⓘ 就变成「选完才发现」。 */}
      {value.landedFilter === 'also-matched'
        ? <p className="intelligence-notification-form-note" role="status">
          {text['pages.intelligence.notification.landed.cost']}
        </p>
        : null}
    </SettingsGroup>
  </div>
}
