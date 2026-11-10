import { useEffect, useState, type ReactElement, type ReactNode } from 'react'

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
  /**
   * 格级启停的读写（宿主注入；真实来源是 main 侧 `createCellEnabledStore`，走 IPC 或直接传函数）。
   * 读失败一律按「启用」显示——不把开关画成关闭（那会假装读者关过它）。
   */
  cellEnabledIo?: Readonly<{
    read: () => Promise<Record<string, boolean>>
    write: (cellId: string, enabled: boolean) => Promise<void>
  }>
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

  const isBusiness = props.filter === 'dashboard'
  const sourceNames = (props.surface.text as unknown as { sourceNames: Record<string, string> }).sourceNames ?? {}
  /**
   * 格级启停：缺键 = 启用；读失败也按启用显示。**只在这里存一份读回来的显式值**，
   * 存储层之外不再造第二份默认值表。
   */
  const [cellEnabled, setCellEnabled] = useState<Readonly<Record<string, boolean>>>({})
  useEffect(() => {
    let cancelled = false
    if (props.cellEnabledIo === undefined) return
    void props.cellEnabledIo.read()
      .then((saved) => { if (!cancelled) setCellEnabled(saved) })
      // 读失败不是「全关」：保持空表 → 所有格按启用显示。
      .catch(() => { if (!cancelled) setCellEnabled({}) })
    return () => { cancelled = true }
  }, [props.cellEnabledIo])
  const isCellEnabled = (cellId: string): boolean => cellEnabled[cellId] ?? true
  const onCellToggle = props.cellEnabledIo === undefined
    ? undefined
    : (cellId: string, enabled: boolean): void => {
      // 同值重复写由存储层短路，这里不再「先读再比」。
      setCellEnabled((current) => ({ ...current, [cellId]: enabled }))
      void props.cellEnabledIo?.write(cellId, enabled).catch(() => undefined)
    }

  /* **一个骨架**：页签条只在这一处渲染一次；两个分类只换「列表」与「内容」。
     切换 tab 时页签条的 DOM 节点不重挂载（用户 2026-11-11：「tab 一切你整个重做了」）。 */
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
      {isBusiness
        ? <BusinessSettingsView
          business={business}
          onBusinessChange={setBusiness}
          resolveText={resolveText}
          sourceNames={sourceNames} />
        : <SettingsSourceTree
          bare
          filter={props.filter}
          labels={props.treeLabels}
          onFilterChange={props.onFilterChange}
          onSelectProvider={props.onSelectProvider}
          selectedProviderId={props.selectedProviderId}
          view={props.view} />}
    </aside>
    <div className="settings-detail-pane intelligence-detail-pane">
      {isBusiness
        ? <BusinessSettingsContent
          business={business}
          {...(onCellToggle === undefined ? {} : { onCellToggle })}
          isCellEnabled={isCellEnabled}
          resolveText={resolveText}
          sourceNames={sourceNames} />
        : <>
          {props.notice}
          {provider === undefined
            ? null
            : <div className="intelligence-detail-scroll"><SourceConfigSurface {...surface} provider={provider} /></div>}
        </>}
    </div>
  </>
}
