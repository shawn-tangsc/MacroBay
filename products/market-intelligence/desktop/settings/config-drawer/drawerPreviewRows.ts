// 只描述版式。数据接入时整个文件删掉，别让它长成第二份事实源。
//
// 这一版**不带任何值**：只有「哪个菜单、哪一组、哪几行、每行是什么形状」。
// 行标签一律用 i18n 键（`labelKey`），中英文案不写在这里。
//
// 键的来历分两种：
// - 已存在：`settings.intelligenceSources.collectionPolicy.*` 等，见下方 `EXISTING_LABEL_KEYS`；
// - **拿不准 / 还没建**：只记在 `PENDING_LABEL_KEYS` 里报给 Chief，**不在 productText.ts 里试插**。

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
export const DRAWER_MENUS = ['sources', 'processing', 'analysis', 'briefing', 'notifications', 'platform'] as const
export type ConfigDrawerMenu = (typeof DRAWER_MENUS)[number]

/** 已经确认存在的文案键（写在这里 = 我核过它今天就在文案表里）。 */
export const EXISTING_LABEL_KEYS = {
  collectionPreset: 'settings.intelligenceSources.collectionPolicy.collectionPreset',
  includeInSentiment: 'settings.intelligenceSources.collectionPolicy.includeInSentiment',
  translation: 'settings.intelligenceSources.translationPreferences.translation'
} as const

/** 还没建/没核实的键：报给 Chief 决定，不在文案表里试插。 */
export const PENDING_LABEL_KEYS: readonly string[] = [
  'configDrawer.screens.sources.capabilities',
  'configDrawer.screens.sources.policyNote',
  'configDrawer.screens.processing.sentimentModel',
  'configDrawer.screens.analysis.switch',
  'configDrawer.screens.analysis.model',
  'configDrawer.screens.briefing.publishAt',
  'configDrawer.screens.briefing.window',
  'configDrawer.screens.briefing.editions',
  'configDrawer.screens.briefing.model',
  'configDrawer.screens.notifications.channels',
  'configDrawer.screens.notifications.pushStrength',
  'configDrawer.screens.notifications.calendar',
  'configDrawer.screens.notifications.leadTime',
  'configDrawer.screens.notifications.importance',
  'configDrawer.screens.notifications.landedFilter',
  'configDrawer.screens.notifications.countries',
  'configDrawer.screens.notifications.reach',
  'configDrawer.screens.notifications.masterSwitch',
  'configDrawer.screens.platform.timeZone',
  'configDrawer.screens.platform.language',
  'configDrawer.screens.platform.theme',
  'configDrawer.screens.platform.proxy',
  'configDrawer.screens.platform.modelService'
]

export const DRAWER_PREVIEW_SCREENS: readonly PreviewScreen[] = [
  {
    menu: 'sources',
    groups: [
      {
        titleKey: 'configDrawer.groups.thisSource',
        rows: [
          { key: 'enabled', labelKey: 'configDrawer.screens.sources.enabled', control: 'switch' },
          { key: 'capabilities', labelKey: 'configDrawer.screens.sources.capabilities', control: 'readonly' }
        ]
      },
      {
        titleKey: 'configDrawer.groups.status',
        rows: [
          // 状态组是说明行（不可用 / 上次成功），不是可编辑字段。
          { key: 'status', labelKey: 'configDrawer.screens.sources.status', control: 'noteRow' }
        ]
      },
      {
        titleKey: 'configDrawer.groups.policy',
        rows: [
          { key: 'preset', labelKey: EXISTING_LABEL_KEYS.collectionPreset, control: 'select' },
          { key: 'sentiment', labelKey: EXISTING_LABEL_KEYS.includeInSentiment, control: 'switch' },
          { key: 'policyNote', labelKey: 'configDrawer.screens.sources.policyNote', control: 'noteRow', info: true }
        ]
      }
    ]
  },
  {
    menu: 'processing',
    groups: [
      {
        rows: [
          { key: 'translation', labelKey: EXISTING_LABEL_KEYS.translation, control: 'multiSelect' },
          { key: 'sentimentModel', labelKey: 'configDrawer.screens.processing.sentimentModel', control: 'select' }
        ]
      }
    ]
  },
  {
    menu: 'analysis',
    groups: [
      {
        rows: [
          { key: 'analysisSwitch', labelKey: 'configDrawer.screens.analysis.switch', control: 'switch' },
          { key: 'analysisModel', labelKey: 'configDrawer.screens.analysis.model', control: 'select' }
        ]
      }
    ]
  },
  {
    menu: 'briefing',
    groups: [
      {
        rows: [
          { key: 'publishAt', labelKey: 'configDrawer.screens.briefing.publishAt', control: 'readonly' },
          { key: 'window', labelKey: 'configDrawer.screens.briefing.window', control: 'readonly' },
          { key: 'editions', labelKey: 'configDrawer.screens.briefing.editions', control: 'readonly' },
          { key: 'model', labelKey: 'configDrawer.screens.briefing.model', control: 'readonly' }
        ]
      }
    ]
  },
  {
    menu: 'notifications',
    groups: [
      {
        rows: [
          { key: 'channels', labelKey: 'configDrawer.screens.notifications.channels', control: 'switch' },
          { key: 'pushStrength', labelKey: 'configDrawer.screens.notifications.pushStrength', control: 'select' },
          { key: 'calendar', labelKey: 'configDrawer.screens.notifications.calendar', control: 'switch' },
          { key: 'leadTime', labelKey: 'configDrawer.screens.notifications.leadTime', control: 'select' },
          { key: 'importance', labelKey: 'configDrawer.screens.notifications.importance', control: 'multiSelect' },
          { key: 'landedFilter', labelKey: 'configDrawer.screens.notifications.landedFilter', control: 'select' },
          // 条件行：只有「落地筛选 = 自选国家」时才出现。
          { key: 'countries', labelKey: 'configDrawer.screens.notifications.countries', control: 'multiSelect', when: 'landedFilter === custom' },
          { key: 'reach', labelKey: 'configDrawer.screens.notifications.reach', control: 'multiSelect' },
          { key: 'masterSwitch', labelKey: 'configDrawer.screens.notifications.masterSwitch', control: 'readonly' }
        ]
      }
    ]
  },
  {
    menu: 'platform',
    groups: [
      {
        rows: [
          { key: 'timeZone', labelKey: 'configDrawer.screens.platform.timeZone', control: 'readonly', info: true },
          { key: 'language', labelKey: 'configDrawer.screens.platform.language', control: 'readonly' },
          { key: 'theme', labelKey: 'configDrawer.screens.platform.theme', control: 'readonly' },
          { key: 'proxy', labelKey: 'configDrawer.screens.platform.proxy', control: 'readonly' },
          { key: 'modelService', labelKey: 'configDrawer.screens.platform.modelService', control: 'readonly' }
        ]
      }
    ]
  }
]

/** 交付时报数用：每屏多少行（组标题与说明行都算行，方便和原型逐项对）。 */
export const DRAWER_PREVIEW_ROW_COUNTS: Readonly<Record<ConfigDrawerMenu, number>> = {
  sources: DRAWER_PREVIEW_SCREENS[0]!.groups.reduce((sum, group) => sum + group.rows.length, 0),
  processing: DRAWER_PREVIEW_SCREENS[1]!.groups.reduce((sum, group) => sum + group.rows.length, 0),
  analysis: DRAWER_PREVIEW_SCREENS[2]!.groups.reduce((sum, group) => sum + group.rows.length, 0),
  briefing: DRAWER_PREVIEW_SCREENS[3]!.groups.reduce((sum, group) => sum + group.rows.length, 0),
  notifications: DRAWER_PREVIEW_SCREENS[4]!.groups.reduce((sum, group) => sum + group.rows.length, 0),
  platform: DRAWER_PREVIEW_SCREENS[5]!.groups.reduce((sum, group) => sum + group.rows.length, 0)
}
