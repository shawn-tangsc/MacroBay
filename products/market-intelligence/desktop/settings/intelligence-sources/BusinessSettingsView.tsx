import { ChevronRight } from 'lucide-react'

import { SettingsInfo } from '../settingsInfo'
import {
  AI_ANALYSIS_MODULE,
  modulesForBusiness,
  sourceCountForBusiness,
  type DashboardSourceModule
} from './dashboardSourceModules'

/**
 * 「业务设置」这一屏：左列三项（看板 / 日历 / 舆情）+ 内容区**只有卡片 / 源名**，没有源详情。
 *
 * 用户 2026-11-10/11 的定稿：
 * - 左列三项用**和来源树同一套行样式**：圆角方形头像位、主文字、下面一行小字副标题、右侧 chevron；
 *   副标题写有用的事实——看板「N 个模块」、日历/舆情「N 个源」，数字从数据层算，不写死。
 * - **看板** = 模块卡片（卡头模块名，卡里一行「格名 → 源名」；末尾「AI 分析用」卡只列源名，卡头带 ⓘ）。
 * - **日历 / 舆情** = 平铺的源名列表（不分组、不做卡片）。
 * - 任何一项都**不出现源级详情**：没有源名 `<h2>`、测试连接、注册/获取 Key、API Key、健康、高级、
 *   状态词与按钮；点一行才切到「情报源」页签选中那个源（跳转由宿主做）。
 */
export type BusinessKey = 'dashboard' | 'calendar' | 'sentiment'

const BUSINESS_KEYS: readonly BusinessKey[] = ['dashboard', 'calendar', 'sentiment']

export function BusinessSettingsView(props: {
  /** 顶部那条筛选页签（由宿主给）：业务设置下**常显**在左列最上面，和三项列表是上下两层。 */
  tabs?: React.ReactNode
  business: BusinessKey
  onBusinessChange: (business: BusinessKey) => void
  /** 点某一行 → 切到「情报源」并选中这个源（宿主负责切页签）。 */
  onSelectSource: (sourceId: string) => void
  /** 源 id → 读者看到的名字（来自产品文案，不在组件里写源名）。 */
  sourceNames: Readonly<Record<string, string>>
  resolveText: (key: string) => string
}): React.ReactElement {
  const nameOf = (sourceId: string): string => props.sourceNames[sourceId] ?? sourceId
  const labelOf = (key: string): string => props.resolveText(`settings.intelligenceSources.businessTabs.${key}`)
  const subtitleOf = (business: BusinessKey): string => {
    // 数字来自数据层：模块数读模块清单，源数读去重后的源集合——删掉一个源，这里跟着变。
    const template = business === 'dashboard'
      ? props.resolveText('settings.intelligenceSources.businessSubtitle.modules')
      : props.resolveText('settings.intelligenceSources.businessSubtitle.sources')
    const count = business === 'dashboard'
      ? modulesForBusiness(business).length
      : sourceCountForBusiness(business)
    return template.replace('{count}', String(count))
  }
  return <div className="business-settings">
    <div className="business-settings__nav">
      {props.tabs}
      {/* 与来源树同一套行：头像位 + 主文字 + 副标题 + 右侧 chevron；选中态沿用树里那个类。 */}
      {BUSINESS_KEYS.map((key) => <button
        aria-current={props.business === key ? 'true' : undefined}
        className={`intelligence-provider-row${props.business === key ? ' selected' : ''}`}
        key={key}
        onClick={() => props.onBusinessChange(key)}
        type="button">
        <span className="intelligence-source-avatar" aria-hidden="true">{labelOf(key).slice(0, 1)}</span>
        <span className="intelligence-provider-main">
          <strong>{labelOf(key)}</strong>
          <small>{subtitleOf(key)}</small>
        </span>
        <span className="intelligence-provider-state">
          <ChevronRight aria-hidden="true" size={13} />
        </span>
      </button>)}
    </div>
    <div className="business-settings__content">
      {props.business === 'dashboard'
        ? [...modulesForBusiness('dashboard'), AI_ANALYSIS_MODULE].map((module) => <section
          className="business-card"
          data-business-card={module.id}
          key={module.id}>
          <div className="business-card__title">
            {props.resolveText(module.labelKey)}
            {module.id === 'ai-analysis'
              ? <SettingsInfo
                ariaLabelKey="settings.intelligenceSources.aiAnalysisNoteAria"
                labelKeys={['settings.intelligenceSources.aiAnalysisNote']}
                resolveText={props.resolveText} />
              : null}
          </div>
          {module.cells.map((cell, index) => cardRow(module, index, cell.label, cell.sourceId, nameOf, props.onSelectSource))}
        </section>)
        : null}
      {props.business === 'dashboard'
        ? null
        : <section className="business-card" data-business-card={props.business}>
          {/* 日历 / 舆情：平铺源名（不写格名、没有组头）。 */}
          {modulesForBusiness(props.business)
            .flatMap((module) => module.cells)
            .map((cell, index) => cardRow(undefined, index, '', cell.sourceId, nameOf, props.onSelectSource))}
        </section>}
    </div>
  </div>
}

/** 卡片里的一行：格名（可空）→ 源名；整行可点，点了切到情报源。 */
function cardRow(
  module: DashboardSourceModule | undefined,
  index: number,
  label: string,
  sourceId: string,
  nameOf: (sourceId: string) => string,
  onSelectSource: (sourceId: string) => void
): React.ReactElement {
  return <button
    className="business-card__row"
    key={`${module?.id ?? 'list'}-${index}`}
    onClick={() => onSelectSource(sourceId)}
    type="button">
    {/* 「AI 分析用」卡与日历/舆情列表是**无格名**的：源名放左列、右列留空，行样式与别的行一致。 */}
    <span className="business-card__label">{label === '' ? nameOf(sourceId) : label}</span>
    <span className="business-card__value">{label === '' ? null : nameOf(sourceId)}</span>
  </button>
}
