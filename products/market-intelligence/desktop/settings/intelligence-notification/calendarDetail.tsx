import type { ReactElement, ReactNode } from 'react'

import { Checkbox, Switch } from 'antd'

import { LoadingState } from '@platform/ui/components/loading'
import { Segmented } from '@platform/ui/components/segmented'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'

import { CALENDAR_REMINDER_LEAD_MINUTES } from '../../../contracts/calendarEventReminder'
import { CalendarLandedCountriesRow } from './calendarLandedCountriesRow'
import type { SettingDescriptor } from '../../shared/settings/descriptorTypes'
import { settingRegistry } from '../../shared/settings/registry'
import { SettingField } from '../../shared/settings/SettingField'
import { SettingsGroup, SettingsInfo, SettingsRow } from './settingsRow'
import type { CalendarReminderSettingsState } from './useCalendarReminderSettings'
import type { useSurfaceSelection } from './useSurfaceSelection'
import { CALENDAR_LANDED_FILTER_KEYS, CALENDAR_REMINDER_LEAD_KEYS } from './notificationKeys'

type SurfaceState = ReturnType<typeof useSurfaceSelection>

/** 详情行对应的声明：按 key 找，不兜底——声明缺了就是编译/测试的红。 */
function detailDescriptor(key: string): SettingDescriptor {
  const descriptor = settingRegistry.notifications.find((row) => row.key === key)
  if (!descriptor) throw new Error(`missing setting descriptor: ${key}`)
  return descriptor
}

const ROW_CLASS = 'intelligence-notification-form-row'
const LABEL_CLASS = 'intelligence-notification-form-label'
const LABEL_TEXT_CLASS = 'intelligence-notification-form-label-text'
const CONTROL_CLASS = 'intelligence-notification-form-control'


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
  /** 两个动作组：开始前那一行、落地那一行，各自贴在控件右侧。 */
  upcomingAction?: ReactNode
  landedAction?: ReactNode
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
      aside={<SettingsInfo
        ariaLabelKey="pages.intelligence.notification.calendar.aboutAria"
        labelKeys={['pages.intelligence.notification.calendar.surfacesNote']}
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
          : <SettingField
            busy={surfaces.saving}
            checkboxClassName="intelligence-notification-form-check"
            controlWrapperClassName={CONTROL_CLASS}
            copyClassName={LABEL_CLASS}
            descriptor={detailDescriptor('setting:notifications.surfaces')}
            labelTextClassName={LABEL_TEXT_CLASS}
            onChange={(next) => {
              const picked = Array.isArray(next) ? next.map(String) : []
              // 控件给整份选择，命令收单个面的增量：只把变化的那一个面交给页面 toggle。
              const changed = surfaces.available.find(
                (surface) => picked.includes(surface) !== (surfaces.selection[surface] === true)
              )
              if (changed !== undefined) surfaces.toggle(changed, picked.includes(changed))
            }}
            resolveOptionLabel={(option) =>
              text[`pages.intelligence.notification.surface.${String(option)}`] ?? String(option)}
            resolveText={props.resolveText}
            rowClassName={`${ROW_CLASS} is-last`}
            showHelp={false}
            value={surfaces.available.filter((surface) => surfaces.selection[surface] === true)}
            view={surfaces}
          >
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
            {/* 写失败必须当场说：以前这一格失败时页面一声不响、勾选回原样，
                读者看到的就是「点了没反应」。中性文字，不上状态色。 */}
            {surfaces.saveFailed
              ? <span className="intelligence-notification-form-note" role="status">
                {text['pages.intelligence.notification.saveFailed']}
              </span>
              : null}
          </SettingField>}
    </SettingsGroup>

    <SettingsGroup
      aside={<SettingsInfo
        ariaLabelKey="pages.intelligence.notification.calendar.beforeAria"
        labelKeys={['pages.intelligence.notification.calendar.beforeNote']}
        resolveText={props.resolveText}
      />}
      title={text['pages.intelligence.notification.calendar.before'] ?? ''}
    >
      {/* 关着时只留一行状态摘要（提前量 + 重要性），不让两个控件看起来能用却不起作用。 */}
      <SettingField
        busy={reminder.saving}
        controlWrapperClassName={CONTROL_CLASS}
        copyClassName={LABEL_CLASS}
        descriptor={detailDescriptor('setting:notifications.calendar.enabled')}
        labelTextClassName={LABEL_TEXT_CLASS}
        onChange={(next) => reminder.update({ enabled: next === true })}
        resolveOptionLabel={() => ''}
        resolveText={props.resolveText}
        rowClassName={`${ROW_CLASS}${!value.enabled ? ' is-last' : ''}`}
        showHelp={false}
        value={value.enabled}
        view={value}
      >
        {/* 关着时把**已存的值**摆出来（状态 + 提前量 + 重要性），不是一句话：
            正文只允许字段名、当前值、控件。 */}
        {value.enabled
          ? null
          : <span className="intelligence-notification-form-note">
            {[
              text['pages.intelligence.notification.status.off'] ?? '',
              lead(value.leadMinutes),
              value.importance
                .map((level) => text[`pages.intelligence.notification.importance.${level}`] ?? level)
                .join(text['pages.intelligence.notification.joiner'] ?? ' / ')
            ].join(text['pages.intelligence.notification.joiner'] ?? ' / ')}
          </span>}
        {props.upcomingAction ?? null}
      </SettingField>
      {value.enabled
        ? <>
          <SettingField
            busy={reminder.saving}
            controlWrapperClassName={CONTROL_CLASS}
            copyClassName={LABEL_CLASS}
            descriptor={detailDescriptor('setting:notifications.calendar.lead')}
            labelTextClassName={LABEL_TEXT_CLASS}
            onChange={(next) => reminder.update({ leadMinutes: Number(next) as typeof value.leadMinutes })}
            resolveOptionLabel={(option, source) =>
              text[`pages.intelligence.notification.leads.${String(option)}`] ?? String(option)}
            resolveText={props.resolveText}
            rowClassName={ROW_CLASS}
            showHelp={false}
            value={value.leadMinutes}
            view={value}
          />
          <SettingField
            busy={reminder.saving}
            checkboxClassName="intelligence-notification-form-check"
            controlWrapperClassName={CONTROL_CLASS}
            copyClassName={LABEL_CLASS}
            descriptor={detailDescriptor('setting:notifications.calendar.importance')}
            labelTextClassName={LABEL_TEXT_CLASS}
            onChange={(next) => reminder.update({ importance: next as typeof value.importance })}
            resolveOptionLabel={(option) =>
              text[`pages.intelligence.notification.importance.${String(option)}`] ?? String(option)}
            resolveText={props.resolveText}
            rowClassName={`${ROW_CLASS} is-last`}
            showHelp={false}
            value={value.importance}
            view={value}
          />
        </>
        : null}
      {reminder.saveFailedField === 'enabled' || reminder.saveFailedField === 'leadMinutes' || reminder.saveFailedField === 'importance'
        ? <SettingsRow label="" last>
          <span className="intelligence-notification-form-note" role="status">
            {text['pages.intelligence.notification.saveFailed']}
          </span>
        </SettingsRow>
        : null}
    </SettingsGroup>

    <SettingsGroup title={text['pages.intelligence.notification.calendar.after'] ?? ''}>
      <SettingField
        busy={reminder.saving}
        controlWrapperClassName={CONTROL_CLASS}
        copyClassName={LABEL_CLASS}
        descriptor={detailDescriptor('setting:notifications.calendar.landed-filter')}
        helpAriaLabelKey="pages.intelligence.notification.calendar.landedInfoAria"
        labelTextClassName={LABEL_TEXT_CLASS}
        onChange={(next) => reminder.update({ landedFilter: next as typeof value.landedFilter })}
        resolveOptionLabel={(option) =>
          text[`pages.intelligence.notification.landed.${String(option)}`] ?? String(option)}
        resolveText={props.resolveText}
        rowClassName={ROW_CLASS}
        value={value.landedFilter}
        view={value}
      >
        {props.landedAction ?? null}
      </SettingField>
      <CalendarLandedCountriesRow
        last
        onChange={(next) => reminder.update({ landedCountries: next })}
        resolveText={props.resolveText}
        saveFailedField={reminder.saveFailedField}
        saving={reminder.saving}
        selection={value.landedCountries}
        text={props.text}
      />
    </SettingsGroup>
  </div>
}
