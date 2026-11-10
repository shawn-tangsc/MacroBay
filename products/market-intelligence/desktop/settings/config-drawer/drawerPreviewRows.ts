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
export const DRAWER_MENUS = ['sources', 'processing', 'analysis', 'briefing', 'notifications', 'platform'] as const
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
          { key: 'enabled', labelKey: 'configDrawer.rows.enabled', control: 'switch' },
          { key: 'capabilities', labelKey: 'configDrawer.rows.capabilities', control: 'readonly' }
        ]
      },
      {
        titleKey: 'configDrawer.groups.status',
        rows: [
        ]
      },
      {
        titleKey: 'configDrawer.groups.policy',
        rows: [
          { key: 'preset', labelKey: EXISTING_LABEL_KEYS.collectionPreset, control: 'select' },
          { key: 'sentiment', labelKey: EXISTING_LABEL_KEYS.includeInSentiment, control: 'switch' },
          { key: 'policyNote', labelKey: 'configDrawer.rows.policyNote', control: 'noteRow', info: true }
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
          { key: 'sentimentModel', labelKey: 'configDrawer.rows.sentimentModel', control: 'select' }
        ]
      }
    ]
  },
  {
    menu: 'analysis',
    groups: [
      {
        rows: [
          { key: 'analysisSwitch', labelKey: 'configDrawer.rows.analysisSwitch', control: 'switch' },
          { key: 'analysisModel', labelKey: 'configDrawer.rows.analysisModel', control: 'select' }
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
          { key: 'model', labelKey: 'configDrawer.rows.briefingModel', control: 'readonly' }
        ]
      }
    ]
  },
  {
    menu: 'notifications',
    groups: [
      {
        rows: [
          { key: 'channels', labelKey: 'configDrawer.rows.channels', control: 'switch' },
          { key: 'pushStrength', labelKey: 'configDrawer.rows.pushStrength', control: 'select' },
          { key: 'calendar', labelKey: 'configDrawer.rows.calendar', control: 'switch' },
          { key: 'leadTime', labelKey: 'configDrawer.rows.leadTime', control: 'select' },
          { key: 'importance', labelKey: 'configDrawer.rows.importance', control: 'multiSelect' },
          { key: 'landedFilter', labelKey: 'configDrawer.rows.landedFilter', control: 'select' },
          // 条件行：只有「落地筛选 = 自选国家」时才出现。
          { key: 'countries', labelKey: 'configDrawer.rows.countries', control: 'multiSelect', when: 'landedFilter === custom' },
          { key: 'reach', labelKey: 'configDrawer.rows.reach', control: 'multiSelect' },
          { key: 'masterSwitch', labelKey: 'configDrawer.rows.masterSwitch', control: 'readonly' }
        ]
      }
    ]
  },
  {
    menu: 'platform',
    groups: [
      {
        rows: [
          { key: 'timeZone', labelKey: 'configDrawer.rows.timeZone', control: 'readonly', info: true },
          { key: 'language', labelKey: 'configDrawer.rows.language', control: 'readonly' },
          { key: 'theme', labelKey: 'configDrawer.rows.theme', control: 'readonly' },
          { key: 'proxy', labelKey: 'configDrawer.rows.proxy', control: 'readonly' },
          { key: 'modelService', labelKey: 'configDrawer.rows.modelService', control: 'readonly' }
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
