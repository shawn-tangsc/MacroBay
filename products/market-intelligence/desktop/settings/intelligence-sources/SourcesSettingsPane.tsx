import { useEffect, useState, type ReactElement, type ReactNode } from 'react'

import { Segmented } from '@platform/ui/components/segmented'

import { notifySettingsRevision } from '../../shared/events/settingsRevision'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import { BusinessSettingsContent, BusinessSettingsView, type BusinessFocus, type BusinessKey } from './BusinessSettingsView'
import { cellIdOf, modulesForBusiness } from './dashboardSourceModules'

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
   * 宿主指定「这一屏要哪个视图」（用户 2026-11-11：抽屉把它拆成两个菜单项，页签条整条去掉）。
   * 给了 `pane` 就**不画页签条**、也不再按 `filter` 二选一；没给（平台设置页那面）保持原行为：
   * 画六项页签、按 `filter` 切「情报源 / 业务设置」。
   */
  pane?: 'sources' | 'business'
  /** 采集与数据里「源没开启」的项点击后跳配置页；宿主实现切屏与选中。 */
  onOpenSourceConfig?: (sourceId: string) => void
  /** 「舆情」右边那张入口卡 → 配置抽屉的「内容处理」屏（页面层的现成回调）。 */
  onOpenProcessingSettings?: () => void
  /**
   * 抽屉的屏内定位（只作初值）：先切到那个业务，再把那张模块卡/那一格带进视野一次。
   * 找不到就什么都不做——读者不会被拽走，也不会看到空白。
   */
  initialBusinessPosition?: BusinessFocus
  /**
   * 格级启停的读写（宿主注入；真实来源是 main 侧 `createCellEnabledStore`，走 IPC 或直接传函数）。
   * 读失败一律按「启用」显示——不把开关画成关闭（那会假装读者关过它）。
   */
  cellEnabledIo?: Readonly<{
    read: () => Promise<Record<string, boolean>>
    write: (cellId: string, enabled: boolean) => Promise<void>
    /** 这一格选了哪个源（互斥/选中）。宿主不传就不写选中，只写启停。 */
    writeSelection?: (cellId: string, sourceId: string | null) => Promise<void>
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
  /**
   * 「业务设置」这一屏自己的三项；只在 filter === 'dashboard' 时生效。
   * 初值可以由入口指定（`focus.sourcesData.business`），之后归读者。
   */
  const [business, setBusiness] = useState<BusinessKey>(props.initialBusinessPosition?.business ?? 'dashboard')
  /*
    定位只在挂载时用一次，且只认两个锚点：给了 `cellId` 就落到那一格，否则落到那张模块卡。
    依赖写成两个字符串，不写整个对象——调用点每次渲染都会给新对象，写成对象就是每次渲染都重新滚一遍。
  */
  const focusCellId = props.initialBusinessPosition?.cellId
  const focusModuleKey = props.initialBusinessPosition?.moduleKey
  useEffect(() => {
    if (focusCellId === undefined && focusModuleKey === undefined) return undefined
    const selector = focusCellId === undefined
      ? `[data-business-card="${focusModuleKey}"]`
      : `[data-cell-id="${focusCellId}"]`
    const anchor = document.querySelector<HTMLElement>(selector)
    if (anchor === null) return undefined
    anchor.scrollIntoView?.({ block: 'nearest' })
    anchor.setAttribute('data-focused', 'true')
    return () => { anchor.removeAttribute('data-focused') }
  }, [focusCellId, focusModuleKey])
  const provider = props.view?.groups
    .flatMap((group) => group.providers)
    .find((entry) => entry.providerId === props.selectedProviderId)
  const { providerId: _selected, ...surface } = props.surface

  const isBusiness = props.pane === undefined ? props.filter === 'dashboard' : props.pane === 'business'
  const sourceNames = (props.surface.text as unknown as { sourceNames: Record<string, string> }).sourceNames ?? {}
  /* 源自己的采集开关（投影值）：采集与数据里的项靠它判断「背后的源开没开」。 */
  const sourceEnabledById = new Map<string, boolean>()
  for (const group of props.view?.groups ?? []) {
    for (const provider of group.providers) for (const source of provider.sources) sourceEnabledById.set(source.sourceId, source.enabled)
  }
  const isSourceEnabled = (sourceId: string): boolean | undefined => sourceEnabledById.get(sourceId)
  /**
   * 「采集与数据」第二行的数据：**只有可配置的已启用源**才给预设值（不是把下拉画成禁用）。
   * 值来自 `surface.policy.profiles`（与详情同一份），写走同一个 `onChange`（按源单字段 patch），
   * 不新造通道、也不使用详情那份草稿快照。
   */
  const presetValues: Record<string, string> = {}
  const builtinCadence = new Set<string>()
  const presetPolicy = props.surface.policy
  for (const group of props.view?.groups ?? []) {
    for (const provider of group.providers) {
      for (const source of provider.sources) {
        if (!source.enabled || source.visibility === 'pending' || source.unavailable !== undefined) continue
        /* 已启用的源项**一律**占住频率那一行（用户 2026-11-12：不可调的也要占位、说明「内置频率」，
           否则并排的卡片会高高低低，读者看不出这些源有什么区别）。
           不能调的两种事实——节奏由产品自己的作业定、没有通用采集器——走同一个「内置」形态；
           判定只读投影里的 `collectionOwner` / `collection`，不按源 id 写死。 */
        if (source.collectionOwner === 'product' || source.collection === 'none') {
          builtinCadence.add(source.sourceId)
          continue
        }
        if (presetPolicy === undefined) continue
        const profile = presetPolicy.profiles[source.sourceId]
        if (profile !== undefined) presetValues[source.sourceId] = profile.collectionPreset
      }
    }
  }
  const onPresetChange = presetPolicy === undefined
    ? undefined
    : (sourceId: string, preset: string): void => {
      presetPolicy.onChange(sourceId, { collectionPreset: preset as never })
    }
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
  /* 只回**显式写过**的格；缺键交给调用方按「主源默认开、备用行默认关」解释，
     否则界面上主备两个源会同时显示为开（用户 2026-11-11：同一格只有一个源在用）。 */
  const isCellEnabled = (cellId: string): boolean | undefined => cellEnabled[cellId]
  /**
   * 卡片项那颗开关**只写格**（用户 2026-11-12）：打开时写格 true + 选中该源；关闭时只写格 false。
   * **不碰源的启停**——源采不采只由「数据源」页头那颗决定。用户原话：「关某个源项，怎么能自动把源也关了」；
   * 以前「关最后一个格就把源停掉」会让关一格顺带把整条源的采集 job 注销，这条退路已经删掉。
   */
  const cellSourceOf = new Map<string, string>()
  for (const module of modulesForBusiness('dashboard')) {
    for (const cell of module.cells) cellSourceOf.set(cellIdOf(module.id, cell), cell.sourceId)
  }
  const cellRevisionOrigin = props.surface.revisionOrigin ?? 'sources-cell'
  const onCellToggle = props.cellEnabledIo === undefined
    ? undefined
    : (cellId: string, enabled: boolean): void => {
      const io = props.cellEnabledIo!
      setCellEnabled((current) => ({ ...current, [cellId]: enabled }))
      const sourceId = cellSourceOf.get(cellId)
      /* 开一格 = 写格 true + 选中该源，两次写**合并成一次**域信号（发两条会让另一边重读两遍）。
         写失败：**不发信号**，现有失败处理（静默、开关按读回值显示）不变——不能把失败画成已生效。 */
      const writes: Array<Promise<void>> = [io.write(cellId, enabled)]
      if (enabled && sourceId !== undefined && io.writeSelection !== undefined) {
        writes.push(io.writeSelection(cellId, sourceId))
      }
      void Promise.all(writes)
        .then(() => { notifySettingsRevision('sources', cellRevisionOrigin) })
        .catch(() => undefined)
    }

  /* **一个骨架**：页签条只在这一处渲染一次；两个分类只换「列表」与「内容」。
     切换 tab 时页签条的 DOM 节点不重挂载（用户 2026-11-11：「tab 一切你整个重做了」）。 */
  return <>
    <aside className="intelligence-catalog-pane intelligence-catalog-pane--filtered">
      {props.pane === undefined
        ? <div className="intelligence-catalog-filters">
          <Segmented
            ariaLabelKey="settings.intelligenceSources.sourceFilterLabel"
            items={props.treeFilters ?? DEFAULT_FILTERS}
            onChange={(value) => props.onFilterChange(value as SourceFilter)}
            resolveText={resolveText}
            value={props.filter} />
        </div>
        : null}
      {isBusiness
        ? <BusinessSettingsView
          business={business}
          onBusinessChange={setBusiness}
          resolveText={resolveText}
          sourceNames={sourceNames} />
        : <SettingsSourceTree
          bare
          /* 「数据源」这屏**平铺不分组**、列全部可见源（灰的也在）；模块分组只留给「采集与数据」的卡片。 */
          flat={props.pane === 'sources'}
          filter={props.pane === 'sources' ? 'all' : props.filter}
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
          isSourceEnabled={isSourceEnabled}
          {...(props.onOpenSourceConfig === undefined ? {} : { onOpenSourceConfig: props.onOpenSourceConfig })}
          {...(props.onOpenProcessingSettings === undefined ? {} : { onOpenProcessingSettings: props.onOpenProcessingSettings })}
          {...(onPresetChange === undefined ? {} : { onPresetChange })}
          presets={presetValues}
          {...(builtinCadence.size === 0 ? {} : { builtinCadence })}
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
