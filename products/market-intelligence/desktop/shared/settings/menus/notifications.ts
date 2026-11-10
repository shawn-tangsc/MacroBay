import { MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS } from '../../../../contracts/notificationEventKeys'
import { CALENDAR_REMINDER_GROUP_KEY, type CalendarLandedFilter, type CalendarReminderLeadMinutes } from '../../../../contracts/calendarEventReminder'
import type { NewsSentimentTierThreshold } from '../../../../contracts/newsSentimentTiers'

import type { SettingDescriptor } from '../descriptorTypes'
import { firstChangedSurface, readSelection, readViewField } from '../descriptorTypes'

export const NOTIFICATION_ROWS: readonly SettingDescriptor[] = Object.freeze([
  {
    key: 'setting:notifications.channel-event.signal-triggered',
    menu: 'notifications',
    surfaces: ['settings'],
    level: 'platform',
    field: { kind: 'switch' },
    read: {
      command: 'platform:notifications-get-channel-events',
      select: (view) => readViewField(readViewField(view, 'events'), MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS.signalTriggered)
    },
    write: {
      kind: 'command',
      id: 'platform:notifications-set-channel-event',
      toArgs: (value) => ({ eventId: MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS.signalTriggered, enabled: value === true })
    },
    copy: {
      labelKey: 'pages.intelligence.notification.rows.signalTriggered.title',
      helpKey: 'pages.intelligence.notification.rows.signalTriggered.info'
    },
    availability: 'live'
  },
  {
    key: 'setting:notifications.channel-event.briefing-ready',
    menu: 'notifications',
    surfaces: ['settings'],
    level: 'platform',
    field: { kind: 'switch' },
    read: {
      command: 'platform:notifications-get-channel-events',
      select: (view) => readViewField(readViewField(view, 'events'), MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS.briefingReady)
    },
    write: {
      kind: 'command',
      id: 'platform:notifications-set-channel-event',
      toArgs: (value) => ({ eventId: MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS.briefingReady, enabled: value === true })
    },
    copy: {
      labelKey: 'pages.intelligence.notification.rows.briefingReady.title',
      helpKey: 'pages.intelligence.notification.rows.briefingReady.info'
    },
    availability: 'live'
  },
  {
    // 舆情提醒挂着 `sentimentAlert` 的 itemKey，但**不是**那条事件的批准位：读者拨的是推送水位
    // （`intelligence.setNewsPushOutletEnabled`），批准值由批准文件与平台决定，本页不暴露。
    key: 'setting:notifications.push-outlet',
    menu: 'notifications',
    surfaces: ['settings'],
    level: 'product',
    field: { kind: 'switch' },
    read: {
      command: 'intelligence.getNewsPushOutletState',
      select: (view) => readViewField(view, 'enabled')
    },
    write: {
      kind: 'value',
      command: 'intelligence.setNewsPushOutletEnabled',
      toPayload: (value) => ({ enabled: value === true })
    },
    copy: {
      labelKey: 'pages.intelligence.notification.rows.sentimentAlert.title',
      helpKey: 'pages.intelligence.notification.rows.sentimentAlert.info'
    },
    availability: 'live'
  },
  {
    // 「日历事件」是产品自己的提醒设置：开关在详情「开始前」组内，**列表行只显示状态徽标**。
    // 不要按别的行在列表上再补一个开关——那会凭空多出一个入口。
    key: 'setting:notifications.calendar.enabled',
    menu: 'notifications',
    surfaces: ['settings'],
    level: 'product',
    field: { kind: 'switch' },
    read: {
      command: 'intelligence.getCalendarReminderSettings',
      select: (view) => readViewField(view, 'enabled')
    },
    write: {
      kind: 'value',
      command: 'intelligence.setCalendarReminderSettings',
      toPayload: (value) => ({ enabled: value === true })
    },
    defaultValueFrom: 'calendarReminder.enabled',
    copy: {
      labelKey: 'pages.intelligence.notification.calendar.beforeRow',
      helpKey: 'pages.intelligence.notification.calendar.beforeNote'
    },
    availability: 'live'
  },
  {
    key: 'setting:notifications.push-threshold',
    menu: 'notifications',
    surfaces: ['settings'],
    level: 'product',
    field: { kind: 'select', optionsFrom: 'news-push-thresholds', presentation: 'segmented' },
    read: { command: 'intelligence.getNewsPushThreshold', select: (view) => readViewField(view, 'pushThreshold') },
    write: {
      kind: 'value',
      command: 'intelligence.saveNewsPushThreshold',
      toPayload: (value) => ({ pushThreshold: value as NewsSentimentTierThreshold })
    },
    defaultValueFrom: 'newsPushThreshold',
    copy: {
      labelKey: 'pages.intelligence.notification.threshold.row',
      // 两条说明（怎么算 + 代价），读屏名是专用键——与页面那一行的 ⓘ 逐字一致。
      helpKeys: [
        'pages.intelligence.notification.threshold.info',
        'pages.intelligence.notification.threshold.cost'
      ],
      helpAriaKey: 'pages.intelligence.notification.threshold.aria'
    },
    availability: 'live'
  },
  {
    key: 'setting:notifications.calendar.lead',
    menu: 'notifications',
    surfaces: ['settings'],
    level: 'product',
    field: { kind: 'select', optionsFrom: 'calendar-reminder-leads', presentation: 'segmented' },
    read: { command: 'intelligence.getCalendarReminderSettings', select: (view) => readViewField(view, 'leadMinutes') },
    write: {
      kind: 'value',
      command: 'intelligence.setCalendarReminderSettings',
      toPayload: (value) => ({ leadMinutes: value as CalendarReminderLeadMinutes })
    },
    defaultValueFrom: 'calendarReminder.leadMinutes',
    // 契约：只在「开始前」开着时出现；关着时只留一行状态摘要。
    visibleWhen: (view) => readViewField(view, 'enabled') === true,
    copy: {
      labelKey: 'pages.intelligence.notification.calendar.lead',
      helpKey: 'pages.intelligence.notification.calendar.beforeNote'
    },
    availability: 'live'
  },
  {
    key: 'setting:notifications.calendar.importance',
    menu: 'notifications',
    surfaces: ['settings'],
    level: 'product',
    field: { kind: 'multiSelect', optionsFrom: 'calendar-reminder-importance' },
    read: { command: 'intelligence.getCalendarReminderSettings', select: (view) => readViewField(view, 'importance') },
    write: {
      kind: 'value',
      command: 'intelligence.setCalendarReminderSettings',
      toPayload: (value) => ({ importance: value })
    },
    defaultValueFrom: 'calendarReminder.importance',
    visibleWhen: (view) => readViewField(view, 'enabled') === true,
    copy: {
      labelKey: 'pages.intelligence.notification.calendar.importance',
      helpKey: 'pages.intelligence.notification.calendar.beforeNote'
    },
    availability: 'live'
  },
  {
    key: 'setting:notifications.calendar.landed-filter',
    menu: 'notifications',
    surfaces: ['settings'],
    level: 'product',
    field: { kind: 'select', optionsFrom: 'calendar-landed-filter', presentation: 'segmented' },
    read: { command: 'intelligence.getCalendarReminderSettings', select: (view) => readViewField(view, 'landedFilter') },
    write: {
      kind: 'value',
      command: 'intelligence.setCalendarReminderSettings',
      toPayload: (value) => ({ landedFilter: value as CalendarLandedFilter })
    },
    defaultValueFrom: 'calendarReminder.landedFilter',
    copy: {
      labelKey: 'pages.intelligence.notification.calendar.landedRow',
      helpKey: 'pages.intelligence.notification.landed.cost'
    },
    availability: 'live'
  },
  {
    key: 'setting:notifications.calendar.landed-countries.scope',
    menu: 'notifications',
    surfaces: ['settings'],
    level: 'product',
    field: { kind: 'select', optionsFrom: 'calendar-landed-scopes' },
    read: {
      command: 'intelligence.getCalendarReminderSettings',
      select: (view) => readViewField(readViewField(view, 'landedCountries'), 'scope')
    },
    write: {
      kind: 'value',
      command: 'intelligence.setCalendarReminderSettings',
      toPayload: (value, view) => ({
        // 两格是一份对象：改范围不能把读者已勾的国家清掉（非 custom 时服务端本来也只存空）。
        landedCountries: {
          scope: value,
          codes: value === 'custom' ? readViewField(readViewField(view, 'landedCountries'), 'codes') ?? [] : []
        }
      })
    },
    defaultValueFrom: 'calendarReminder.landedCountryScope',
    copy: {
      labelKey: 'pages.intelligence.notification.countries.row',
      // 一颗 ⓘ 两条说明：范围说明 + 「全部国家」的含义；读屏名单独给（不继承字段名）。
      helpKeys: [
        'pages.intelligence.notification.countries.scopeNote',
        'pages.intelligence.notification.countries.allNote'
      ],
      helpAriaKey: 'pages.intelligence.notification.countries.rowInfoAria'
    },
    availability: 'live'
  },
  {
    key: 'setting:notifications.calendar.landed-countries.codes',
    menu: 'notifications',
    surfaces: ['settings'],
    level: 'product',
    field: { kind: 'multiSelect', optionsFrom: 'calendar-landed-country-codes' },
    read: {
      command: 'intelligence.getCalendarReminderSettings',
      select: (view) => readViewField(readViewField(view, 'landedCountries'), 'codes')
    },
    write: {
      kind: 'value',
      command: 'intelligence.setCalendarReminderSettings',
      toPayload: (value) => ({ landedCountries: { scope: 'custom', codes: value } })
    },
    // 契约：仅「自选国家」时出现（`calendarLandedCountries.ts` 的 scope 条件多选）。
    visibleWhen: (view) => readViewField(readViewField(view, 'landedCountries'), 'scope') === 'custom',
    copy: {
      labelKey: 'pages.intelligence.notification.countries.customTitle',
      // 两条说明（只对给出国家的条目生效 + 只有选中的国家会推），读屏名专用——与页面一致。
      helpKeys: [
        'pages.intelligence.notification.countries.customCost',
        'pages.intelligence.notification.countries.emptyHint'
      ],
      helpAriaKey: 'pages.intelligence.notification.countries.customInfoAria'
    },
    availability: 'live'
  },
  {
    // 触达面：读者看到的是「一件事」，控件就是一份多选；平台命令收的却是「单个面的增量」，
    // 所以增量在 `toArgs` 里算（一次点击本来也只变一个面），不为了命令形状拆成四个开关。
    key: 'setting:notifications.surfaces',
    menu: 'notifications',
    surfaces: ['settings'],
    level: 'platform',
    // 选项来自平台返回的 `available`（今天只有 channel / toast；中心恒收、不在可选项里）。
    field: { kind: 'multiSelect', optionsFrom: { kind: 'view', field: 'available' } },
    read: {
      command: 'platform:notifications-get-surface-selection',
      select: (view) => readViewField(view, 'selection')
    },
    write: {
      kind: 'command',
      id: 'platform:notifications-set-surface-selection',
      toArgs: (value, view) => {
        const before = readViewField(view, 'selection')
        const changed = firstChangedSurface(before, value)
        // 中心恒收：它永远不算增量，即使调用方把整份选择原样传上来。
        return {
          eventTypeId: CALENDAR_REMINDER_GROUP_KEY,
          surfaces: changed === undefined || changed === 'center'
            ? {}
            : { [changed]: readSelection(value, changed) === true }
        }
      }
    },
    copy: {
      labelKey: 'pages.intelligence.notification.calendar.surfaceRow',
      // 两条并进**同一颗** ⓘ：先说「不管勾几个都会记到通知中心」（读者点开就是为这个答案），
      // 再说这处管哪两条通知——顺序是界面设计 2026-11-10 定的。
      helpKeys: [
        'pages.intelligence.notification.calendar.surfacesCenterNote',
        'pages.intelligence.notification.calendar.surfacesNote'
      ],
      helpAriaKey: 'pages.intelligence.notification.calendar.aboutAria'
    },
    availability: 'live'
  }
])
