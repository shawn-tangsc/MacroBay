import { useState, type ReactElement } from 'react'

import { LoadingState } from '@platform/ui/components/loading'
import { SettingsSection } from '@platform/ui/components/settings-section'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'
import { StatusPill } from '@platform/ui/components/status-pill'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import type { SettingDescriptor } from '../../shared/settings/descriptorTypes'
import { settingRegistry } from '../../shared/settings/registry'
import { SettingField } from '../../shared/settings/SettingField'
import { CalendarDetail } from './calendarDetail'
import { NewsPushThresholdRow } from './newsPushThresholdRow'
import { SettingsInfo } from './settingsRow'
import { TestNotificationButton } from './testNotificationButton'
import { intelligenceNotificationText } from './text'
import { useCalendarReminderSettings } from './useCalendarReminderSettings'
import { INTELLIGENCE_CHANNEL_EVENT_ROWS, useChannelEventSettings } from './useChannelEventSettings'
import { useNewsPushOutletSwitch } from './useNewsPushOutletSwitch'
import { useNewsPushThreshold } from './useNewsPushThreshold'
import { useNotificationLayout } from './useNarrowWindow'
import { useSurfaceSelection } from './useSurfaceSelection'

/**
 * 情报 · 通知（设置页与配置抽屉共用这一份内容）。
 *
 * 版式与「来源与采集」同一套语言：
 * - 左：目录列表（分组标题 + 行 + 状态词），容器与行都用 `intelligence-catalog-pane` 那一套；
 * - 右：`SettingsSection` + 设置行（区块标题 13/650、行 44、标签 160、控件左缘对齐）；
 * - 整屏级提示（通道未就绪）在内容上方一条 inline notice；解释进 ⓘ，不单独悬空；
 * - 抽屉不画页标题；860 断点只属设置页（那一面量自己的宽度，窄了把列表换成下拉）。
 *
 * 数据只在 hook 里：读命令、写命令、文案键各一份，本文件不碰 IPC。
 */

type ItemKey = (typeof INTELLIGENCE_CHANNEL_EVENT_ROWS)[number]['itemKey']

const ITEM_KEYS: readonly ItemKey[] = INTELLIGENCE_CHANNEL_EVENT_ROWS.map((row) => row.itemKey)
const ROW_BY_ITEM = Object.fromEntries(
  INTELLIGENCE_CHANNEL_EVENT_ROWS.map((row) => [row.itemKey, row])
) as Readonly<Record<ItemKey, (typeof INTELLIGENCE_CHANNEL_EVENT_ROWS)[number]>>
const CALENDAR_GROUP_EVENT_ID = 'market-intelligence.calendar.event-upcoming'

const SWITCH_DESCRIPTOR_BY_ITEM: Readonly<Record<Exclude<ItemKey, 'calendar'>, string>> = {
  signal: 'setting:notifications.channel-event.signal-triggered',
  briefing: 'setting:notifications.channel-event.briefing-ready',
  sentiment: 'setting:notifications.push-outlet'
}

const ROW_CLASS = 'intelligence-notification-form-row'
const LABEL_CLASS = 'intelligence-notification-form-label'
const LABEL_TEXT_CLASS = 'intelligence-notification-form-label-text'
const CONTROL_CLASS = 'intelligence-notification-form-control'

function descriptorOf(key: string): SettingDescriptor {
  const descriptor = settingRegistry.notifications.find((row) => row.key === key)
  // 没有兜底：声明缺失是编译/测试的红，不许静默少一行。
  if (!descriptor) throw new Error(`missing setting descriptor: ${key}`)
  return descriptor
}

/** 从通知中心点「去设置」进来时落到对应那一项；定位不到落第一项，不猜。 */
export function itemForFocus(focusEntityId: string | null | undefined): ItemKey {
  if (!focusEntityId) return 'signal'
  const row = INTELLIGENCE_CHANNEL_EVENT_ROWS.find((entry) => entry.eventId === focusEntityId)
  if (row) return row.itemKey
  if (focusEntityId.startsWith('market-intelligence.calendar.')) return 'calendar'
  if (focusEntityId === 'market-intelligence.macro.event-landed') return 'calendar'
  return 'signal'
}

export const MIGRATED_SETTING_KEYS: readonly string[] = [
  ...Object.values(SWITCH_DESCRIPTOR_BY_ITEM),
  'setting:notifications.push-threshold',
  'setting:notifications.surfaces',
  'setting:notifications.calendar.enabled',
  'setting:notifications.calendar.lead',
  'setting:notifications.calendar.importance',
  'setting:notifications.calendar.landed-filter',
  'setting:notifications.calendar.landed-countries.scope',
  'setting:notifications.calendar.landed-countries.codes'
]

export function NotificationPageScreen({ focusEntityId }: Readonly<{
  /** 从通知中心点「去设置」进来时落到哪一项。 */
  focusEntityId?: string | null
}>): ReactElement {
  const language = useShellLanguage()
  const text = intelligenceNotificationText[language]
  const resolveText = (key: string): string => text[key] ?? ''
  const { status, values, savingEventId, failedEventIds, channelReady, reload, toggle } = useChannelEventSettings()
  const outlet = useNewsPushOutletSwitch()
  const threshold = useNewsPushThreshold()
  const reminder = useCalendarReminderSettings()
  const surfaces = useSurfaceSelection(CALENDAR_GROUP_EVENT_ID)
  const [selected, setSelected] = useState<ItemKey>(() => itemForFocus(focusEntityId))
  const { setSectionRef, layout } = useNotificationLayout()

  /** 列表里那一行只报**状态**；「读取中」不是 settled 状态，不画药丸。 */
  const listState = (key: ItemKey): 'on' | 'off' | 'unreadable' | 'loading' => {
    if (key === 'calendar') {
      if (reminder.status === 'loading') return 'loading'
      if (reminder.value === undefined) return 'unreadable'
      return reminder.value.enabled ? 'on' : 'off'
    }
    const row = ROW_BY_ITEM[key]
    const enabled = row.control === 'outlet' ? outlet.enabled : values[row.eventId] ?? true
    return enabled ? 'on' : 'off'
  }

  const itemName = (key: ItemKey): string => text[ROW_BY_ITEM[key].titleKey] ?? ''
  const stateWord = (key: ItemKey): string => {
    const state = listState(key)
    return text[`pages.intelligence.notification.status.${state}`] ?? ''
  }

  const shell = (children: ReactElement, busy = false): ReactElement =>
    <section aria-busy={busy ? 'true' : undefined} className="settings-workspace intelligence-notification-workspace" ref={setSectionRef}>{children}</section>

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

  const narrow = layout.mode === 'dropdown'

  /** 抽屉固定双栏；设置页窄窗把列表换成下拉（860 只属设置页这一面）。 */
  const list = narrow
    ? <div className="intelligence-notification-narrow">
      <select
        aria-label={text['pages.intelligence.notification.groupTitle'] ?? ''}
        onChange={(event) => setSelected(event.target.value as ItemKey)}
        value={selected}
      >
        {ITEM_KEYS.map((key) => <option key={key} value={key}>
          {`${itemName(key)}${text['pages.intelligence.notification.joiner'] ?? ' / '}${stateWord(key)}`}
        </option>)}
      </select>
    </div>
    : <aside className="intelligence-catalog-pane">
      <div className="intelligence-catalog-list">
        <div className="intelligence-catalog-group">
          <div className="intelligence-catalog-group-title">{text['pages.intelligence.notification.rowsGroup'] ?? ''}</div>
          {ITEM_KEYS.map((key) => {
            const state = listState(key)
            return <section className="intelligence-provider-group" key={key}>
              <button
                aria-current={key === selected ? 'true' : undefined}
                className={`intelligence-provider-row${key === selected ? ' selected' : ''}`}
                onClick={() => setSelected(key)}
                type="button"
              >
                <span className="intelligence-provider-main"><strong>{itemName(key)}</strong></span>
                {state === 'loading'
                  ? <span className="intelligence-notification-row-loading">{text['pages.intelligence.notification.status.loading'] ?? ''}</span>
                  : <StatusPill
                    labelKey={`pages.intelligence.notification.status.${state}`}
                    resolveText={resolveText}
                    tone={state === 'on' ? 'ok' : 'muted'}
                  />}
              </button>
            </section>
          })}
        </div>
      </div>
    </aside>

  const switchRow = (key: Exclude<ItemKey, 'calendar'>): ReactElement => {
    const row = ROW_BY_ITEM[key]
    const enabled = row.control === 'outlet' ? outlet.enabled : values[row.eventId] ?? true
    const saving = row.control === 'outlet' ? outlet.saving : savingEventId === row.eventId
    const failed = row.control === 'outlet' ? outlet.saveFailed : failedEventIds.has(row.eventId)
    return <SettingField
      busy={saving}
      controlWrapperClassName={CONTROL_CLASS}
      copyClassName={LABEL_CLASS}
      descriptor={descriptorOf(SWITCH_DESCRIPTOR_BY_ITEM[key])}
      labelTextClassName={LABEL_TEXT_CLASS}
      onChange={(next) => {
        if (row.control === 'outlet') outlet.setEnabled(next === true)
        else toggle(row.eventId, next === true)
      }}
      resolveOptionLabel={() => ''}
      resolveText={resolveText}
      rowClassName={ROW_CLASS}
      value={enabled}
      view={{}}
    >
      {failed
        ? <span className="intelligence-notification-form-note" role="status">{text['pages.intelligence.notification.saveFailed'] ?? ''}</span>
        : null}
      {key === 'sentiment'
        ? <TestNotificationButton
          channelReady={channelReady}
          disabled={!enabled}
          kind="sentiment"
          labelKey="pages.intelligence.notification.test.sentiment"
          resolveText={resolveText}
        />
        : null}
    </SettingField>
  }

  const detail = selected === 'calendar'
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
    : <SettingsSection title={itemName(selected)}>
      {switchRow(selected)}
      {selected === 'sentiment'
        ? <NewsPushThresholdRow
          last
          resolveText={resolveText}
          state={threshold}
          text={text}
        />
        : null}
    </SettingsSection>

  return shell(<>
    <div className="config-drawer__split intelligence-notification-split">
      {list}
      <section className="settings-detail-pane">
        <div className="intelligence-notification-head">
          <h2 className="intelligence-notification-title">{text['pages.intelligence.notification.groupTitle']}</h2>
          <SettingsInfo
            ariaLabelKey="pages.intelligence.notification.infoAria"
            labelKeys={['pages.intelligence.notification.groupInfo.2', 'pages.intelligence.notification.channelNotReady']}
            resolveText={resolveText}
          />
        </div>
        {channelReady ? null : <p className="intelligence-notification-form-note" role="status">
          {text['pages.intelligence.notification.channelNotReadyState']}
        </p>}
        {detail}
      </section>
    </div>
  </>)
}
