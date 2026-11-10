// 只描述版式。数据接入时整个文件删掉，别让它长成第二份事实源。
//
// 这一版**不带任何值**：只有「哪个菜单、哪一组、哪几行、每行是什么形状」。
// 行标签一律用 i18n 键（`labelKey`），中英文案不写在这里。
//
// 键的来历分两种：
// - 已存在：`settings.intelligenceSources.collectionPolicy.*` 等，见下方 `EXISTING_LABEL_KEYS`；
// 键都在 `productText[lang].pages.intelligence.portal.dashboard.configDrawer.rows` 下，中英各一份。

/** 控件外观。只描述形状，不带行为、不带值。 */
export type PreviewControl =
  | 'switch'
  | 'select'
  | 'multiSelect'
  | 'number'
  | 'readonly'
  | 'info'
  | 'groupTitle'
  | 'noteRow'

export type PreviewRow = {
  /** 行 key：同一屏内唯一（数据接入时按它定位）。 */
  key: string
  /** i18n 键，不写句子。 */
  labelKey: string
  control: PreviewControl
  /** 行标签旁有没有 ⓘ（形状，不是行为）。 */
  info?: boolean
  /** 条件行：满足条件才出现（例如国家码只在「自选国家」时出现）。 */
  when?: string
}

export type PreviewGroup = {
  /** 分组标题的键；没有分组标题的这一屏不写。 */
  titleKey?: string
  rows: readonly PreviewRow[]
}

export type PreviewScreen = {
  menu: ConfigDrawerMenu
  groups: readonly PreviewGroup[]
}

/** 六个菜单（顺序即左栏顺序）。 */
export const DRAWER_MENUS = ['sources', 'processing', 'analysis', 'briefing', 'notifications', 'runLog'] as const
export type ConfigDrawerMenu = (typeof DRAWER_MENUS)[number]


/** 已经确认存在的文案键（写在这里 = 我核过它今天就在文案表里）。 */
export const EXISTING_LABEL_KEYS = {
  collectionPreset: 'settings.intelligenceSources.collectionPolicy.collectionPreset',
  includeInSentiment: 'settings.intelligenceSources.collectionPolicy.includeInSentiment',
  translation: 'settings.intelligenceSources.translationPreferences.title'
} as const

export const DRAWER_PREVIEW_SCREENS: readonly PreviewScreen[] = [
  {
    menu: 'sources',
    groups: [
      {
        titleKey: 'configDrawer.groups.thisSource',
        rows: [
          { key: 'enabled', labelKey: 'configDrawer.rows.sourcesEnabled', control: 'switch' },
          { key: 'health', labelKey: 'configDrawer.rows.healthBadge', control: 'noteRow' },
          { key: 'apiKey', labelKey: 'configDrawer.rows.apiKey', control: 'readonly' },
          { key: 'capabilityBoard', labelKey: 'configDrawer.rows.capabilityBoard', control: 'switch' },
          { key: 'capabilityCalendar', labelKey: 'configDrawer.rows.capabilityCalendar', control: 'switch' },
          { key: 'testConnection', labelKey: 'configDrawer.rows.testConnection', control: 'info' },
          { key: 'runNow', labelKey: 'configDrawer.rows.runNow', control: 'info' }
        ]
      },
      {
        titleKey: 'configDrawer.groups.policy',
        rows: [
          { key: 'preset', labelKey: 'configDrawer.rows.preset', control: 'select' },
          { key: 'focusMarkets', labelKey: 'configDrawer.rows.focusMarkets', control: 'readonly' },
          { key: 'retention', labelKey: 'configDrawer.rows.retention', control: 'readonly' },
          { key: 'syncRuns', labelKey: 'configDrawer.rows.syncRuns', control: 'readonly' },
          { key: 'calendarFeeds', labelKey: 'configDrawer.rows.calendarFeeds', control: 'switch' }
        ]
      }
    ]
  },
  {
    menu: 'processing',
    groups: [
      {
        rows: [
          { key: 'autoTranslate', labelKey: 'configDrawer.rows.autoTranslate', control: 'readonly' },
          { key: 'targetLocale', labelKey: 'configDrawer.rows.targetLocale', control: 'readonly' },
          { key: 'translationModel', labelKey: 'configDrawer.rows.translationModel', control: 'readonly' },
          { key: 'sentimentModel', labelKey: 'configDrawer.rows.sentimentModel', control: 'readonly' },
          { key: 'retentionMode', labelKey: 'configDrawer.rows.retentionMode', control: 'readonly' }
        ]
      }
    ]
  },
  {
    menu: 'analysis',
    groups: [
      {
        rows: [
          { key: 'analysisSwitch', labelKey: 'configDrawer.rows.analysisSwitch', control: 'readonly' },
          { key: 'analysisModel', labelKey: 'configDrawer.rows.analysisModel', control: 'readonly' }
        ]
      }
    ]
  },
  {
    menu: 'briefing',
    groups: [
      {
        rows: [
          { key: 'publishAt', labelKey: 'configDrawer.rows.publishAt', control: 'readonly' },
          { key: 'window', labelKey: 'configDrawer.rows.window', control: 'readonly' },
          { key: 'editions', labelKey: 'configDrawer.rows.editions', control: 'readonly' },
          { key: 'generationLanguage', labelKey: 'configDrawer.rows.generationLanguage', control: 'readonly' },
          { key: 'aiEditing', labelKey: 'configDrawer.rows.aiEditing', control: 'readonly' },
          { key: 'aiBackfill', labelKey: 'configDrawer.rows.aiBackfill', control: 'readonly' },
          { key: 'briefingModel', labelKey: 'configDrawer.rows.briefingModel', control: 'readonly' }
        ]
      }
    ]
  },
  {
    menu: 'notifications',
    groups: [
      {
        titleKey: 'configDrawer.groups.status',
        rows: [
          // 四条频道事件拆开：并成一行只读，等于把读者今天能拨的事画成「这里改不了」。
          // 本版只读 + 跳转，**写路径 0.4.4 开**。
          { key: 'notifyEventSignal', labelKey: 'configDrawer.rows.notifyEventSignal', control: 'readonly' },
          { key: 'notifyEventBriefing', labelKey: 'configDrawer.rows.notifyEventBriefing', control: 'readonly' },
          { key: 'notifyEventSentiment', labelKey: 'configDrawer.rows.notifyEventSentiment', control: 'readonly' },
          { key: 'notifyEventCalendar', labelKey: 'configDrawer.rows.notifyEventCalendar', control: 'readonly' },
          // 触达面是「多个可勾选项」，不是开关：值是列出已勾选的方式，本轮只读、不画可勾控件。
          { key: 'notifyChannels', labelKey: 'configDrawer.rows.channels', control: 'readonly' },
          { key: 'notifyStrength', labelKey: 'configDrawer.rows.pushStrength', control: 'select' },
          { key: 'notifyCalendar', labelKey: 'configDrawer.rows.calendar', control: 'switch' },
          { key: 'notifyLead', labelKey: 'configDrawer.rows.leadTime', control: 'select' },
          { key: 'notifyImportance', labelKey: 'configDrawer.rows.importance', control: 'multiSelect' },
          { key: 'notifyFilter', labelKey: 'configDrawer.rows.landedFilter', control: 'select' },
          { key: 'notifyCountries', labelKey: 'configDrawer.rows.countries', control: 'multiSelect', when: 'landedFilter === custom' },
          { key: 'reach', labelKey: 'configDrawer.rows.reach', control: 'multiSelect' },
          { key: 'quietHours', labelKey: 'configDrawer.rows.quietHours', control: 'readonly' }
        ]
      }
    ]
  },

]

/** 还是**静态占位**的屏各自的·行数（日报已接真数据，不在表里）。 */
export const DRAWER_PREVIEW_ROW_COUNTS: Readonly<Partial<Record<ConfigDrawerMenu, number>>> = {
  sources: 12,
  processing: 5,
  analysis: 2,
  briefing: 7,
  notifications: 10,
  runLog: 0
}
