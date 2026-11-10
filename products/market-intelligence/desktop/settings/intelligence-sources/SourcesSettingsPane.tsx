import { useState, type ReactElement, type ReactNode } from 'react'

import { Segmented } from '@platform/ui/components/segmented'

import { useProductTextKey } from '../../shared/i18n/productTextKey'
import { BusinessSettingsContent, BusinessSettingsView, type BusinessKey } from './BusinessSettingsView'

import type { SettingsView } from '../../../service/intelligence/application/sourceProjection'
import { SettingsSourceTree, type SourceFilter } from './SettingsSourceTree'
import { SourceConfigSurface, type SourceConfigSurfaceProps } from './SourceConfigSurface'

// 样式跟着组件走，不跟着页面入口走：配置抽屉直接渲染本组件、不经过 settings 的 index.tsx，
// 只在那里 import 会让抽屉里的来源屏完全没有样式（2026-11-10 用户实机撞到）。
import './intelligence-sources.css'

/**
 * 「来源与采集」的两栏：**左侧源树 + 右侧单源配置**。
 *
 * 抽出来的原因：设置页与产品内「配置」抽屉要显示同一块东西。抄外观不是复用——两处各画一遍，
 * 迟早一边加了四格健康、另一边没加。所以把**同一块实现**交出去，参数就是数据与回调。
 *
 * 边界写死：**提示条（「别处改了、保留草稿」这类）不进来**——它是页面的语气，属于页面；
 * 这里只管树、详情两栏与它们的选择状态。加载态与读不到也归页面（页面知道该整屏给哪个状态）。
 */
export type SourcesSettingsPaneProps = {
  view?: SettingsView
  selectedProviderId?: string
  onSelectProvider: (providerId: string) => void
  filter: SourceFilter
  onFilterChange: (filter: SourceFilter) => void
  /** 左栏标题与分类名等文案。 */
  treeLabels: Parameters<typeof SettingsSourceTree>[0]['labels']
  /**
   * 右栏顶部那条页面级提示（「别处改了 / 保留草稿」）。**内容与动作仍归页面**，
   * 这里只提供位置——它在右栏里、紧挨被提示的那一版，位置与抽取前一致。
   */
  notice?: ReactNode
  /** 右栏那份「事实 + 文案」组装件需要的全部入参（由调用方原样给）。 */
  surface: Omit<SourceConfigSurfaceProps, 'provider'> & { providerId?: string }
  /** 这一面显示哪几块筛选（抽屉传四块，设置页默认六项）。 */
  treeFilters?: ReadonlyArray<{ value: SourceFilter; labelKey: string }>
}

/** 设置页与抽屉共用的六块 / 五块筛选（业务设置那一屏也要这一条）。 */
const DEFAULT_FILTERS = [
  { value: 'all', labelKey: 'settings.intelligenceSources.sourceFilters.all' },
  { value: 'calendar', labelKey: 'settings.intelligenceSources.sourceFilters.calendar' },
  { value: 'dashboard', labelKey: 'settings.intelligenceSources.sourceFilters.dashboard' },
  { value: 'sentiment', labelKey: 'settings.intelligenceSources.sourceFilters.sentiment' },
  { value: 'pending', labelKey: 'settings.intelligenceSources.sourceFilters.pending' },
  { value: 'advanced', labelKey: 'settings.intelligenceSources.sourceFilters.advanced' }
] as const

export function SourcesSettingsPane(props: SourcesSettingsPaneProps): ReactElement {
  const resolveText = useProductTextKey()
  /** 「业务设置」这一屏自己的三项；只在 filter === 'dashboard' 时生效。 */
  const [business, setBusiness] = useState<BusinessKey>('dashboard')
  const provider = props.view?.groups
    .flatMap((group) => group.providers)
    .find((entry) => entry.providerId === props.selectedProviderId)
  const { providerId: _selected, ...surface } = props.surface

  if (props.filter === 'dashboard') {
    /* **业务设置不是情报源那套**：第二栏只列三项，内容区只有卡片 / 平铺源名，没有任何源级详情。
       页签条由这一屏统一画（与情报源那一面同一个位置），业务视图只交列表与内容。 */
    const providerOf = (sourceId: string): string | undefined => props.view?.groups
      .flatMap((group) => group.providers)
      .find((entry) => entry.sources.some((source) => source.sourceId === sourceId))?.providerId
    const sourceNames = (props.surface.text as unknown as { sourceNames: Record<string, string> }).sourceNames ?? {}
    const onSelectSource = (sourceId: string): void => {
      const providerId = providerOf(sourceId)
      if (providerId !== undefined) props.onSelectProvider(providerId)
      props.onFilterChange('all')
    }
    return <>
      <aside className="intelligence-catalog-pane intelligence-catalog-pane--filtered">
        <div className="intelligence-catalog-filters">
          <Segmented
            ariaLabelKey="settings.intelligenceSources.sourceFilterLabel"
            items={props.treeFilters ?? DEFAULT_FILTERS}
            onChange={(value) => props.onFilterChange(value as SourceFilter)}
            resolveText={resolveText}
            value={props.filter} />
        </div>
        <BusinessSettingsView
          business={business}
          onBusinessChange={setBusiness}
          onSelectSource={onSelectSource}
          resolveText={resolveText}
          sourceNames={sourceNames} />
      </aside>
      <div className="settings-detail-pane intelligence-detail-pane">
        <BusinessSettingsContent
          business={business}
          onSelectSource={onSelectSource}
          resolveText={resolveText}
          sourceNames={sourceNames} />
      </div>
    </>
  }

  return <>
    <SettingsSourceTree
      filter={props.filter}
      {...(props.treeFilters === undefined ? {} : { filters: props.treeFilters })}
      labels={props.treeLabels}
      selectedProviderId={props.selectedProviderId}
      view={props.view}
      onFilterChange={props.onFilterChange}
      onSelectProvider={props.onSelectProvider}
    />
    <div className="settings-detail-pane intelligence-detail-pane">
      {props.notice}
      {provider === undefined
        ? null
        : <div className="intelligence-detail-scroll"><SourceConfigSurface {...surface} provider={provider} /></div>}
    </div>
  </>
}
