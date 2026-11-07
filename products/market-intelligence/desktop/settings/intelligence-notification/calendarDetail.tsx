import type { ReactElement } from 'react'

import { Info } from 'lucide-react'
import { Checkbox, Switch } from 'antd'

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

/** 组标题旁的 ⓘ：整句说明只在这里，正文里只剩字段名、当前值和控件（§8.6）。 */
function SectionInfo(props: Readonly<{
  labelKey: string
  ariaLabelKey: string
  resolveText: (key: string) => string
}>): ReactElement {
  return <Popover
    labelKey={props.labelKey}
    resolveText={props.resolveText}
    trigger={(triggerProps) => (
      <IconButton
        {...triggerProps}
        ariaLabelKey={props.ariaLabelKey}
        icon={Info}
        resolveText={props.resolveText}
        size="sm"
        variant="plain"
      />
    )}
  />
}

/**
 * 「日历事件」的详情（界面规范 v1.10 §8，版式对齐定版预览稿）。
 *
 * 结构固定：**通知方式（整项级，在最上）→ 开始前 → 发生后**。原来自制的
 * 「开始前 —— 事件发生 —— 发生后」那行文字删掉了：两个小节标题本身就说顺序，
 * 那行是装饰、零信息量，还多出一级文字层级。
 *
 * 每块都是「组标题 + 若干行」，每行是「标签 160 + 控件 + 可选一行说明」；
 * 整句解释全进组标题旁的 ⓘ，正文只留字段名、当前值和控件。
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
  const notifyLabel = text['pages.intelligence.notification.calendar.surfaceRow'] ?? ''

  return <div className="intelligence-notification-calendar-detail">
    <SettingsGroup
      aside={<SectionInfo
        ariaLabelKey="pages.intelligence.notification.calendar.aboutAria"
        labelKey="pages.intelligence.notification.calendar.surfacesNote"
        resolveText={props.resolveText}
      />}
      title={text['pages.intelligence.notification.calendar.surfaces'] ?? ''}
    >
      {surfaces.status === 'error'
        ? <SettingsRow label={notifyLabel} last>
          <span className="intelligence-notification-form-note" role="status">
            {text['pages.intelligence.notification.surfacesUnreadable']}
          </span>
        </SettingsRow>
        : surfaces.status === 'loading'
          ? <LoadingState ariaLabel={text['pages.intelligence.notification.calendar.surfaces'] ?? ''} />
          : <SettingsRow label={notifyLabel} last>
            <div className="intelligence-notification-form-checks" role="group" aria-label={notifyLabel}>
              {surfaces.available.map((surface) => (
                <Checkbox
                  checked={surfaces.selection[surface] ?? false}
                  className="intelligence-notification-form-check"
                  disabled={surfaces.saving}
                  key={surface}
                  onChange={() => surfaces.toggle(surface, !(surfaces.selection[surface] ?? false))}
                >
                  {text[`pages.intelligence.notification.surface.${surface}`] ?? surface}
                </Checkbox>
              ))}
            </div>
            {/* 勾了却不会响：当场说清（「不许点了没反应」的同一件事），勾选框本身不灰。 */}
            {surfaces.conflict
              ? <span className="intelligence-notification-form-note" role="status">
                {text['pages.intelligence.notification.surfacesConflict']}
              </span>
              : null}
            {surfaces.available.some((surface) => surface === 'toast' && (surfaces.selection.toast ?? false) && surfaces.toastMasterOff)
              ? <span className="intelligence-notification-form-note" role="status">
                {text['pages.intelligence.notification.surfaceBlocked.toast']}
              </span>
              : null}
          </SettingsRow>}
    </SettingsGroup>

    <SettingsGroup
      aside={<SectionInfo
        ariaLabelKey="pages.intelligence.notification.calendar.beforeAria"
        labelKey="pages.intelligence.notification.calendar.beforeNote"
        resolveText={props.resolveText}
      />}
      title={text['pages.intelligence.notification.calendar.before'] ?? ''}
    >
      {/* 关着时只留一行状态摘要（提前量 + 重要性），不让两个控件看起来能用却不起作用。 */}
      <SettingsRow
        label={text['pages.intelligence.notification.calendar.beforeRow'] ?? ''}
        last={!value.enabled}
        note={value.enabled
          ? undefined
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
            <div
              aria-label={text['pages.intelligence.notification.calendar.importance']}
              className="intelligence-notification-form-checks"
              role="group"
            >
              {(['high', 'medium', 'low'] as const).map((level) => (
                <Checkbox
                  checked={value.importance.includes(level)}
                  className="intelligence-notification-form-check"
                  disabled={reminder.saving}
                  key={level}
                  onChange={() => reminder.update({
                    importance: value.importance.includes(level)
                      ? value.importance.filter((entry) => entry !== level)
                      : [...value.importance, level]
                  })}
                >
                  {text[`pages.intelligence.notification.importance.${level}`] ?? level}
                </Checkbox>
              ))}
            </div>
          </SettingsRow>
        </>
        : null}
      {reminder.saveFailed
        ? <SettingsRow label="" last>
          <span className="intelligence-notification-form-note" role="status">
            {text['pages.intelligence.notification.saveFailed']}
          </span>
        </SettingsRow>
        : null}
    </SettingsGroup>

    <SettingsGroup title={text['pages.intelligence.notification.calendar.after'] ?? ''}>
      <SettingsRow
        label={text['pages.intelligence.notification.calendar.landedRow'] ?? ''}
        last={value.landedFilter !== 'also-matched'}
      >
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
        ? <SettingsRow label="" last note={text['pages.intelligence.notification.landed.cost']} noteRole="status" />
        : null}
    </SettingsGroup>
  </div>
}
