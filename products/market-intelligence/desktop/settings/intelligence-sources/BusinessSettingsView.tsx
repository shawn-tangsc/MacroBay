import { Segmented } from '@platform/ui/components/segmented'

import { SettingsInfo } from '../settingsInfo'
import { DASHBOARD_TAB_MODULES } from './dashboardSourceModules'

/**
 * 「业务设置」这一屏的内容区：**只有卡片 / 源名，没有源详情**。
 *
 * 用户 2026-11-10/11 的定稿：
 * - 左列三项（看板 / 日历 / 舆情），点了换右边内容；
 * - **看板** = 模块卡片：卡头是模块名，卡里一行一项「格名 → 源名」；末尾「AI 分析用」卡只列源名；
 * - **日历 / 舆情** = 平铺的源名列表（不分组、不做卡片；日历不列未接入的 CoinMarketCal，
 *   舆情不再单列「舆情评分」那行——它不是源）；
 * - **任何一项都不出现源详情头**：不渲染源名 `<h2>`、测试连接、注册/获取 Key、API Key、健康、高级，
 *   也没有状态词和按钮。点一行才切到「情报源」页签选中那个源（跳转由宿主做）。
 */
export type BusinessKey = 'dashboard' | 'calendar' | 'sentiment'

/** 日历那六个源的顺序按冻结文档（`calendarFeedRegistry` 的声明顺序）；CoinMarketCal 未接入，不列。 */
const CALENDAR_SOURCE_IDS = [
  'macro-calendar-fed',
  'macro-calendar-bea',
  'macro-calendar-bls',
  'macro-calendar-0xrouter-economic-data',
  'macro-calendar-0xrouter-financial-events',
  'macro-calendar-0xrouter-central-bank-activities'
] as const

/** 舆情这一屏只用这四个源（新闻阅读与评分都读它们）。 */
const SENTIMENT_SOURCE_IDS = ['sec-rss', 'coindesk-rss', 'binance-announcements', 'okx-latest-announcements'] as const

export function BusinessSettingsView(props: {
  business: BusinessKey
  onBusinessChange: (business: BusinessKey) => void
  /** 点某一行 → 切到「情报源」并选中这个源（宿主负责切页签）。 */
  onSelectSource: (sourceId: string) => void
  /** 源 id → 读者看到的名字（来自产品文案，不在组件里写源名）。 */
  sourceNames: Readonly<Record<string, string>>
  resolveText: (key: string) => string
}): React.ReactElement {
  const nameOf = (sourceId: string): string => props.sourceNames[sourceId] ?? sourceId
  return <div className="business-settings">
    <div className="business-settings__nav">
      <Segmented
        ariaLabelKey="settings.intelligenceSources.businessTabsAria"
        items={[
          { value: 'dashboard', labelKey: 'settings.intelligenceSources.businessTabs.dashboard' },
          { value: 'calendar', labelKey: 'settings.intelligenceSources.businessTabs.calendar' },
          { value: 'sentiment', labelKey: 'settings.intelligenceSources.businessTabs.sentiment' }
        ]}
        onChange={(value) => props.onBusinessChange(value as BusinessKey)}
        resolveText={props.resolveText}
        value={props.business} />
    </div>
    <div className="business-settings__content">
      {props.business === 'dashboard'
        ? DASHBOARD_TAB_MODULES.map((module) => <section className="business-card" data-business-card={module.id} key={module.id}>
          <div className="business-card__title">
            {props.resolveText(module.labelKey)}
            {module.id === 'ai-analysis'
              ? <SettingsInfo
                ariaLabelKey="settings.intelligenceSources.aiAnalysisNoteAria"
                labelKeys={['settings.intelligenceSources.aiAnalysisNote']}
                resolveText={props.resolveText} />
              : null}
          </div>
          {module.cells.map((cell, index) => <button
            className="business-card__row"
            key={`${module.id}-${index}`}
            onClick={() => props.onSelectSource(cell.sourceId)}
            type="button">
            {/* 「AI 分析用」卡是唯一的无格名例外：源名放左列、右列留空，行样式与别的行一致。 */}
            <span className="business-card__label">{cell.label === '' ? nameOf(cell.sourceId) : cell.label}</span>
            <span className="business-card__value">{cell.label === '' ? null : nameOf(cell.sourceId)}</span>
          </button>)}
        </section>)
        : null}
      {props.business === 'calendar'
        ? <section className="business-card" data-business-card="calendar">
          {CALENDAR_SOURCE_IDS.map((sourceId) => <button
            className="business-card__row"
            key={sourceId}
            onClick={() => props.onSelectSource(sourceId)}
            type="button">
            {/* 平铺：这一屏每行只有源名（不写格名，也没有组头）。 */}
            <span className="business-card__label">{nameOf(sourceId)}</span>
            <span className="business-card__value" />
          </button>)}
        </section>
        : null}
      {props.business === 'sentiment'
        ? <section className="business-card" data-business-card="sentiment">
          {SENTIMENT_SOURCE_IDS.map((sourceId) => <button
            className="business-card__row"
            key={sourceId}
            onClick={() => props.onSelectSource(sourceId)}
            type="button">
            <span className="business-card__label">{nameOf(sourceId)}</span>
            <span className="business-card__value" />
          </button>)}
        </section>
        : null}
    </div>
  </div>
}
