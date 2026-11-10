import type { ReactElement, ReactNode } from 'react'

import { LoadingState } from '@platform/ui/components/loading'
import { SettingsSectionHeader } from '@platform/ui/components/settings-section'
import { InlineNotice } from '@platform/ui/components/inline-notice'
import { SettingsRow } from '@platform/ui/components/settings-row'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { Switch } from 'antd'

import type { SettingDescriptor } from '../../shared/settings/descriptorTypes'
import { settingRegistry } from '../../shared/settings/registry'
import { SettingField } from '../../shared/settings/SettingField'
import { openChannelSettings } from '../../shared/navigation/productShellNavigation'
import { CalendarLandedCountriesRow } from './calendarLandedCountriesRow'
import { NewsPushThresholdRow } from './newsPushThresholdRow'
import { SettingsInfo } from './settingsRow'
import { TestNotificationButton } from './testNotificationButton'
import { intelligenceNotificationText } from './text'
import { useCalendarReminderSettings } from './useCalendarReminderSettings'
import { INTELLIGENCE_CHANNEL_EVENT_ROWS, useChannelEventSettings } from './useChannelEventSettings'
import { useNewsPushOutletSwitch } from './useNewsPushOutletSwitch'
import { useNewsPushThreshold } from './useNewsPushThreshold'
import { useSurfaceSelection } from './useSurfaceSelection'

/**
 * 配置抽屉 · 通知（**这一屏自己的实现**，不与设置页共用）。
 *
 * 形状（用户 2026-11-10 看图后定）：**单列区块，不再左列表 + 右详情**——「只有一个开关」的
 * 分类在分栏里右边全是空白，标题还会在列表与详情里重复一遍。
 *
 * 三块：推送提醒（四条开关）→ 舆情条件（舆情开着时出现）→ 日历提醒（日历开着时出现）。
 * 开关只放行尾；带条件的项，条件放在它下面的独立区块，不挤同一行；关掉就整块消失（不灰）。
 * 逐项即时写，没有底部保存栏；没存上一直挂着，直到写成功。
 */

type ItemKey = (typeof INTELLIGENCE_CHANNEL_EVENT_ROWS)[number]['itemKey']

const ROW_BY_ITEM = Object.fromEntries(
  INTELLIGENCE_CHANNEL_EVENT_ROWS.map((row) => [row.itemKey, row])
) as Readonly<Record<ItemKey, (typeof INTELLIGENCE_CHANNEL_EVENT_ROWS)[number]>>
const CALENDAR_GROUP_EVENT_ID = 'market-intelligence.calendar.event-upcoming'

const SWITCH_DESCRIPTOR: Readonly<Record<Exclude<ItemKey, 'calendar'>, string>> = {
  signal: 'setting:notifications.channel-event.signal-triggered',
  briefing: 'setting:notifications.channel-event.briefing-ready',
  sentiment: 'setting:notifications.push-outlet'
}

/* 行与标签用抽屉骨架那一套（标签 160 左列、控件从标签右边界起排、44 高、发丝线）。 */
const ROW_CLASS = 'config-drawer__row'
const LABEL_CLASS = 'config-drawer__label'
const LABEL_TEXT_CLASS = 'config-drawer__label'
const CONTROL_CLASS = 'config-drawer__value'

/** 区块：与平台 `SettingsSection` 同 DOM（标题 13/650 + ⓘ + body），只是多一个 ⓘ 槽。 */
function Section({ title, info, children }: Readonly<{ title: string; info?: ReactNode; children: ReactNode }>): ReactElement {
  return <section className="settings-section" data-settings-section-block="true">
    <SettingsSectionHeader info={info} title={title} />
    <div className="settings-section__body">{children}</div>
  </section>
}

function descriptorOf(key: string): SettingDescriptor {
  const descriptor = settingRegistry.notifications.find((row) => row.key === key)
  if (!descriptor) throw new Error(`missing setting descriptor: ${key}`)
  return descriptor
}

export function NotificationDrawerScreen(): ReactElement {
  const language = useShellLanguage()
  const text = intelligenceNotificationText[language]
  const resolveText = (key: string): string => text[key] ?? ''
  const { status, values, savingEventId, failedEventIds, channelReady, reload, toggle } = useChannelEventSettings()
  const outlet = useNewsPushOutletSwitch()
  const threshold = useNewsPushThreshold()
  const reminder = useCalendarReminderSettings()
  const surfaces = useSurfaceSelection(CALENDAR_GROUP_EVENT_ID)

  if (status === 'loading') {
    return <div className="intelligence-notification-panel" data-notification-panel="true">
      <LoadingState ariaLabel={text['pages.intelligence.notification.groupTitle'] ?? ''} />
    </div>
  }
  if (status === 'error') {
    return <div className="intelligence-notification-panel" data-notification-panel="true">
      <StateView
        action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: reload }}
        reasonCode="unreadable"
        state="error"
      />
    </div>
  }

  const itemName = (key: ItemKey): string => text[ROW_BY_ITEM[key].titleKey] ?? ''

  /** 开关行：标签 + 行内 ⓘ 在左，行尾（先动作、后开关）。 */
  const switchRow = (key: ItemKey, action?: ReactElement): ReactElement => {
    const row = ROW_BY_ITEM[key]
    const enabled = key === 'sentiment' ? outlet.enabled : values[row.eventId] ?? true
    const saving = key === 'sentiment' ? outlet.saving : savingEventId === row.eventId
    const failed = key === 'sentiment' ? outlet.saveFailed : failedEventIds.has(row.eventId)
    const descriptor = descriptorOf(SWITCH_DESCRIPTOR[key as Exclude<ItemKey, 'calendar'>])
    const helpKey = descriptor.copy?.helpKey
    return <SettingsRow
      controlWrapperClassName={CONTROL_CLASS}
      copyClassName={LABEL_CLASS}
      label={<>
        <span className={LABEL_TEXT_CLASS}>{itemName(key)}</span>
        {helpKey === undefined ? null : <SettingsInfo
          ariaLabelKey={descriptor.copy?.helpAriaKey ?? helpKey}
          labelKeys={[helpKey]}
          resolveText={resolveText}
        />}
      </>}
      rowAttributes={{ 'data-setting-key': descriptor.key }}
      rowClassName={ROW_CLASS}
    >
      <Switch
        aria-label={itemName(key)}
        checked={enabled}
        disabled={saving}
        loading={saving}
        onChange={(next) => {
          if (key === 'sentiment') outlet.setEnabled(next)
          else toggle(row.eventId, next)
        }}
        size="small"
      />
      {action ?? null}
      {failed
        ? <span className="intelligence-notification-form-note" role="status">{text['pages.intelligence.notification.saveFailed'] ?? ''}</span>
        : null}
    </SettingsRow>
  }

  const reminderValue = reminder.value
  const calendarOn = reminderValue?.enabled === true
  const joiner = text['pages.intelligence.notification.joiner'] ?? ' / '
  const leadLabel = (minutes: number): string => text[`pages.intelligence.notification.leads.${minutes}`] ?? String(minutes)
  /**
   * 组关着时的**已存值摘要**：与平台那一屏同一句、同一批键（关闭 + 提前量 + 重要性）。
   * 撤掉平台页是换位置，不是减功能——关着也要能看见自己存过什么。
   */
  const storedSummary = reminderValue === undefined
    ? ''
    : [
      text['pages.intelligence.notification.status.off'] ?? '',
      leadLabel(reminderValue.leadMinutes),
      reminderValue.importance
        .map((level) => text[`pages.intelligence.notification.importance.${level}`] ?? level)
        .join(joiner)
    ].join(joiner)

  /** 日历那一行：读不到就不是「关」——给状态词与真重试，不画一颗会被读成「关着」的开关。 */
  const calendarRow = (): ReactElement => {
    if (reminder.status === 'error') {
      return <SettingsRow
        controlWrapperClassName={CONTROL_CLASS}
        copyClassName={LABEL_CLASS}
        label={<span className={LABEL_TEXT_CLASS}>{itemName('calendar')}</span>}
        rowAttributes={{ 'data-setting-key': 'setting:notifications.calendar.enabled' }}
        rowClassName={ROW_CLASS}
      >
        <span className="intelligence-notification-form-note" role="status">
          {text['pages.intelligence.notification.status.unreadable']}
        </span>
        <button className="intelligence-notification-test-action" onClick={reminder.reload} type="button">
          {text['pages.intelligence.notification.retry'] ?? ''}
        </button>
      </SettingsRow>
    }
    if (reminder.status === 'loading' || reminderValue === undefined) {
      return <SettingsRow
        controlWrapperClassName={CONTROL_CLASS}
        copyClassName={LABEL_CLASS}
        label={<span className={LABEL_TEXT_CLASS}>{itemName('calendar')}</span>}
        rowClassName={ROW_CLASS}
      >
        <span className="intelligence-notification-row-loading">{text['pages.intelligence.notification.status.loading'] ?? ''}</span>
      </SettingsRow>
    }
    return <SettingsRow
      controlWrapperClassName={CONTROL_CLASS}
      copyClassName={LABEL_CLASS}
      label={<>
        <span className={LABEL_TEXT_CLASS}>{itemName('calendar')}</span>
        <SettingsInfo
          ariaLabelKey="pages.intelligence.notification.calendar.aboutAria"
          labelKeys={['pages.intelligence.notification.calendar.aboutAria']}
          resolveText={resolveText}
        />
      </>}
      rowAttributes={{ 'data-setting-key': 'setting:notifications.calendar.enabled' }}
      rowClassName={ROW_CLASS}
    >
      {reminder.saveFailedField === 'enabled'
        ? <span className="intelligence-notification-form-note" role="status">{text['pages.intelligence.notification.saveFailed'] ?? ''}</span>
        : null}
      {/* 关着时把**已存的值**摆出来，不是一句话代替配置：读者要能确认自己之前设了什么。 */}
      {reminderValue.enabled
        ? null
        : <span className="intelligence-notification-form-note" data-calendar-summary="true">{storedSummary}</span>}
      <Switch
        aria-label={itemName('calendar')}
        checked={reminderValue.enabled}
        disabled={reminder.saving}
        loading={reminder.saving}
        onChange={(next) => reminder.update({ enabled: next })}
        size="small"
      />
    </SettingsRow>
  }

  return <div className="intelligence-notification-panel" data-notification-panel="true">
    {/* 整屏级事实：通道不通时先说，读者再看内容；解释挂在「推送提醒」块头那颗 ⓘ 上。 */}
    {/* 整屏级事实：通道没配通 → 黄色横幅（caution），右侧一条真动作去频道设置。 */}
    {channelReady ? null : <InlineNotice
      action={{ labelKey: 'pages.intelligence.notification.channelNotReadyAction', onSelect: openChannelSettings }}
      resolveText={resolveText}
      tone="caution"
    >
      {text['pages.intelligence.notification.channelNotReadyState']}
    </InlineNotice>}

    <div className="intelligence-notification-drawer">
      <Section
        info={<SettingsInfo
          ariaLabelKey="pages.intelligence.notification.infoAria"
          labelKeys={['pages.intelligence.notification.groupInfo.2', 'pages.intelligence.notification.channelNotReady']}
          resolveText={resolveText}
        />}
        title={text['pages.intelligence.notification.pushSection'] ?? ''}
      >
        {switchRow('signal')}
        {switchRow('briefing')}
        {switchRow('sentiment', <TestNotificationButton
          channelReady={channelReady}
          disabled={!outlet.enabled}
          kind="sentiment"
          labelKey="pages.intelligence.notification.test.sentiment"
          resolveText={resolveText}
        />)}
        {calendarRow()}
      </Section>

      {/* 舆情条件：**整块常显**（用户 2026-11-11：关着时也要能选到门槛这一项）。
          关着 → 门槛行灰着，并写明「先打开舆情提醒」；打开 → 可改。 */}
      <Section title={text['pages.intelligence.notification.sentimentSection'] ?? ''}>
        <NewsPushThresholdRow
          disabled={!outlet.enabled}
          last
          resolveText={resolveText}
          state={threshold}
          text={text}
        />
      </Section>

      {/* 日历提醒：**整块常显**（用户 2026-11-11：换位置不是减功能）。关着时仍给已存值摘要，
          并且「测试发生后」仍可点（平台那一屏只按设置读不到禁用，不看组开关）；
          只有组开着时才画开始前条件与发生后的过滤 / 国家。 */}
      <Section title={text['pages.intelligence.notification.calendarSection'] ?? ''}>
          {reminder.status === 'error'
            ? <SettingsRow copyClassName={LABEL_CLASS} label={text['pages.intelligence.notification.status.unreadable'] ?? ''} rowClassName={ROW_CLASS}>
              <StateView
                action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: reminder.reload }}
                reasonCode="unreadable"
                state="error"
              />
            </SettingsRow>
            : <>
              {/* 开始前条件与发生后的过滤 / 国家：组关着时收起（抽屉「关掉就收起条件」的版式），
                  组开着才画；测试行不在这一层里，见下。 */}
              {calendarOn ? <>
              <SettingField
                busy={reminder.saving}
                controlWrapperClassName={CONTROL_CLASS}
                copyClassName={LABEL_CLASS}
                descriptor={descriptorOf('setting:notifications.calendar.lead')}
                labelTextClassName={LABEL_TEXT_CLASS}
                onChange={(next) => reminder.update({ leadMinutes: Number(next) as typeof reminderValue.leadMinutes })}
                resolveOptionLabel={(option) => text[`pages.intelligence.notification.leads.${String(option)}`] ?? String(option)}
                resolveText={resolveText}
                rowClassName={ROW_CLASS}
                value={reminderValue.leadMinutes}
                view={reminderValue}
              />
              <SettingField
                busy={reminder.saving}
                checkboxClassName="intelligence-notification-form-check"
                controlWrapperClassName={CONTROL_CLASS}
                copyClassName={LABEL_CLASS}
                descriptor={descriptorOf('setting:notifications.calendar.importance')}
                labelTextClassName={LABEL_TEXT_CLASS}
                onChange={(next) => reminder.update({ importance: next as typeof reminderValue.importance })}
                resolveOptionLabel={(option) => text[`pages.intelligence.notification.importance.${String(option)}`] ?? String(option)}
                resolveText={resolveText}
                rowClassName={ROW_CLASS}
                value={reminderValue.importance}
                view={reminderValue}
              />
              <SettingField
                busy={surfaces.saving}
                checkboxClassName="intelligence-notification-form-check"
                controlWrapperClassName={CONTROL_CLASS}
                copyClassName={LABEL_CLASS}
                descriptor={descriptorOf('setting:notifications.surfaces')}
                labelTextClassName={LABEL_TEXT_CLASS}
                onChange={(next) => {
                  const picked = Array.isArray(next) ? next.map(String) : []
                  const changed = surfaces.available.find(
                    (surface) => picked.includes(surface) !== (surfaces.selection[surface] === true)
                  )
                  if (changed !== undefined) surfaces.toggle(changed, picked.includes(changed))
                }}
                resolveOptionLabel={(option) => text[`pages.intelligence.notification.surface.${String(option)}`] ?? String(option)}
                resolveText={resolveText}
                rowClassName={ROW_CLASS}
                value={surfaces.available.filter((surface) => surfaces.selection[surface] === true)}
                view={surfaces}
              />
              <SettingField
                busy={reminder.saving}
                controlWrapperClassName={CONTROL_CLASS}
                copyClassName={LABEL_CLASS}
                descriptor={descriptorOf('setting:notifications.calendar.landed-filter')}
                labelTextClassName={LABEL_TEXT_CLASS}
                onChange={(next) => reminder.update({ landedFilter: next as typeof reminderValue.landedFilter })}
                resolveOptionLabel={(option) => text[`pages.intelligence.notification.landed.${String(option)}`] ?? String(option)}
                resolveText={resolveText}
                rowClassName={ROW_CLASS}
                value={reminderValue.landedFilter}
                view={reminderValue}
              />
              <CalendarLandedCountriesRow
                onChange={(next) => reminder.update({ landedCountries: next })}
                resolveText={resolveText}
                saveFailedField={reminder.saveFailedField}
                saving={reminder.saving}
                selection={reminderValue.landedCountries}
                text={text}
              />
              </> : null}
              {/* 行尾两颗动作：两条测试各自贴在自己那一行，不挤进条件行。
                  「测试开始前」随组开关禁用（平台同）；「测试发生后」只按设置读不到禁用——
                  组关着也要能测，这是平台那一屏现在就有的能力。 */}
              <SettingsRow
                controlWrapperClassName={CONTROL_CLASS}
                copyClassName={LABEL_CLASS}
                label={<span className={LABEL_TEXT_CLASS}>{text['pages.intelligence.notification.test.sectionLabel'] ?? ''}</span>}
                rowAttributes={{ 'data-setting-key': 'setting:notifications.calendar.test' }}
                rowClassName={`${ROW_CLASS} is-last`}
              >
                <TestNotificationButton
                  channelReady={channelReady}
                  disabled={!calendarOn}
                  kind="calendar-upcoming"
                  labelKey="pages.intelligence.notification.test.calendarUpcoming"
                  resolveText={resolveText}
                />
                <TestNotificationButton
                  channelReady={channelReady}
                  disabled={reminder.status !== 'ready'}
                  kind="calendar-landed"
                  labelKey="pages.intelligence.notification.test.calendarLanded"
                  resolveText={resolveText}
                />
              </SettingsRow>
            </>}
      </Section>
    </div>
  </div>
}
