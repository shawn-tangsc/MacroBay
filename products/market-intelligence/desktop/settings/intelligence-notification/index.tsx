import { useState, type ReactElement } from 'react'

import { Info } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { LoadingState } from '@platform/ui/components/loading'
import { Popover } from '@platform/ui/components/popover'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { intelligenceNotificationText } from './text'
import { CalendarDetail } from './calendarDetail'
import { ContentDetail } from './contentDetail'
import { NewsPushThresholdRow } from './newsPushThresholdRow'
import { NotificationList, type NotificationListItem } from './notificationList'
import { useCalendarReminderSettings } from './useCalendarReminderSettings'
import { INTELLIGENCE_CHANNEL_EVENT_ROWS, useChannelEventSettings } from './useChannelEventSettings'
import { useNewsPushOutletSwitch } from './useNewsPushOutletSwitch'
import { useNewsPushThreshold } from './useNewsPushThreshold'
import { useNotificationLayout } from './useNarrowWindow'
import { useSurfaceSelection } from './useSurfaceSelection'

import './intelligence-notification.css'

/**
 * 设置 → 情报 → 通知（界面规范 v1.9 §8 版式、v2.39 §9d–§9f 内容）。
 *
 * 版式：**标题一行；下面「列表 | 详情」两列**。DOM 顺序就是视觉顺序，标题不在网格里——
 * 三个块塞进两列网格，自动排布会把标题扔进窄格、详情挤到下一行。
 *
 * 内容：三项管「哪些情报内容推手机」，第四项「日历事件」管同一个事件的前后两段。
 * 页面只读服务结果；三层「与」（批准 ∩ 总开关 ∩ 本处选择）由平台算。
 */

type ItemKey = 'signal' | 'briefing' | 'sentiment' | 'calendar'

const ITEM_KEYS: readonly ItemKey[] = ['signal', 'briefing', 'sentiment', 'calendar']

const CONTENT_ITEMS: Readonly<Record<'signal' | 'briefing' | 'sentiment', { eventId: string; row: string }>> = {
  signal: { eventId: INTELLIGENCE_CHANNEL_EVENT_ROWS[0]!.eventId, row: 'signalTriggered' },
  briefing: { eventId: INTELLIGENCE_CHANNEL_EVENT_ROWS[2]!.eventId, row: 'briefingReady' },
  sentiment: { eventId: INTELLIGENCE_CHANNEL_EVENT_ROWS[1]!.eventId, row: 'sentimentAlert' }
}

const CALENDAR_GROUP_EVENT_ID = 'market-intelligence.calendar.event-upcoming'

/** 从通知中心点「去设置」进来时落到对应那一项；定位不到落第一项，不猜。 */
function itemForFocus(focusEntityId: string | null | undefined): ItemKey {
  if (!focusEntityId) return 'signal'
  if (
    focusEntityId.startsWith('market-intelligence.calendar.')
    || focusEntityId === 'market-intelligence.macro.event-landed'
  ) return 'calendar'
  if (focusEntityId === CONTENT_ITEMS.signal.eventId) return 'signal'
  if (focusEntityId === CONTENT_ITEMS.briefing.eventId) return 'briefing'
  if (focusEntityId === CONTENT_ITEMS.sentiment.eventId) return 'sentiment'
  return 'signal'
}

export default function IntelligenceNotificationSettingsSection(
  { focusEntityId }: Readonly<{ focusEntityId?: string | null }> = {}
): ReactElement {
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

  const rowName = (key: ItemKey): string => key === 'calendar' ? 'calendar' : CONTENT_ITEMS[key].row
  const itemName = (key: ItemKey): string => text[`pages.intelligence.notification.rows.${rowName(key)}.title`] ?? ''

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
    const enabled = key === 'sentiment' ? outlet.enabled : values[CONTENT_ITEMS[key].eventId] ?? true
    return enabled
      ? text['pages.intelligence.notification.status.on'] ?? ''
      : text['pages.intelligence.notification.status.off'] ?? ''
  }

  const items: readonly NotificationListItem[] = ITEM_KEYS.map((key) => ({
    key,
    name: itemName(key),
    state: itemState(key)
  }))

  if (status === 'loading') {
    return <section aria-busy="true" className="settings-workspace intelligence-notification-workspace" ref={setSectionRef}>
      <LoadingState ariaLabel={text['pages.intelligence.notification.groupTitle'] ?? ''} />
    </section>
  }
  if (status === 'error') {
    return <section className="settings-workspace intelligence-notification-workspace" ref={setSectionRef}>
      <StateView
        action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: reload }}
        reasonCode="unreadable"
        state="error"
      />
    </section>
  }

  return <section className="settings-workspace intelligence-notification-workspace" ref={setSectionRef}>
    {/* 标题一行：13.5/600/正常色，上 16 下 12；ⓘ 只放「为什么勾了还不响」。 */}
    <div className="intelligence-notification-head">
      <h2 className="intelligence-notification-title">{text['pages.intelligence.notification.groupTitle']}</h2>
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
      <NotificationList
        ariaLabel={text['pages.intelligence.notification.groupTitle'] ?? ''}
        items={items}
        narrow={layout.mode === 'dropdown'}
        onSelect={(key) => setSelected(key as ItemKey)}
        selected={selected}
      />
      <div className="intelligence-notification-detail">
        {/* 详情标题不再重复列表里的名字：同一个名字写两处，迟早有一处说法不同。 */}
        <div className="intelligence-notification-card">
          {selected === 'calendar'
            ? <CalendarDetail reminder={reminder} resolveText={resolveText} surfaces={surfaces} text={text} />
            : <ContentDetail
              enabled={selected === 'sentiment' ? outlet.enabled : values[CONTENT_ITEMS[selected].eventId] ?? true}
              failed={selected === 'sentiment' ? outlet.saveFailed : failedEventId === CONTENT_ITEMS[selected].eventId}
              name={itemName(selected)}
              onChange={(next) => {
                if (selected === 'sentiment') outlet.setEnabled(next)
                else toggle(CONTENT_ITEMS[selected].eventId, next)
              }}
              saveFailedText={text['pages.intelligence.notification.saveFailed'] ?? ''}
              saving={selected === 'sentiment' ? outlet.saving : savingEventId === CONTENT_ITEMS[selected].eventId}
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
          {channelReady ? null : <p className="intelligence-notification-form-note" role="status">
            {text['pages.intelligence.notification.channelNotReady']}
          </p>}
        </div>
      </div>
    </div>
  </section>
}
