import { ChevronRight } from 'lucide-react'

import { Switch } from 'antd'

import { calendarFeedRegistry } from '../../../service/intelligence/macro-calendar/calendarFeedRegistry'
import { SettingsInfo } from '../settingsInfo'
import {
  AI_ANALYSIS_MODULE,
  cellIdOf,
  modulesForBusiness,
  sourceCountForBusiness,
  type DashboardCell,
  type DashboardSourceModule
} from './dashboardSourceModules'

/**
 * 「业务设置」这一屏：左列三项（看板 / 日历 / 舆情）+ 内容区**只有卡片 / 源名**，没有源详情。
 *
 * 用户 2026-11-10/11 的定稿：
 * - 左列三项用**和来源树同一套行样式**：圆角方形头像位、主文字、下面一行小字副标题、右侧 chevron；
 *   副标题写有用的事实——看板「N 个模块」、日历/舆情「N 个源」，数字从数据层算，不写死。
 * - **看板** = 模块卡片；卡里**一行一个源，行标签是源名**（不再写格名）。
 *   一个格有多个候选源（`美元` 有主源 + 备用源）时，外面再包一层**子卡片**（标题 = 格名），
 *   子卡片里是**互斥**的：一个格同一时刻只用一个源，全关 = 这一格不用。
 * - **日历 / 舆情** = 平铺的源名列表（不分组、不做卡片）。
 * - 任何一项都**不出现源级详情**：没有源名 `<h2>`、测试连接、注册/获取 Key、API Key、健康、高级、
 *   状态词与按钮。
 *
 * 互斥用**每格自己的启停**表达（`cells[cellId]`）：开 B 时同组其它源写 false，不开第二个存储。
 * `selection` 那层留给「选源模型」，这里不写 null——null 在存储里是删键 = 回落默认主源。
 */
export type BusinessKey = 'dashboard' | 'calendar' | 'sentiment'

const BUSINESS_KEYS: readonly BusinessKey[] = ['dashboard', 'calendar', 'sentiment']

/** 同一格的多个候选源：键去掉 `-fallback` 后缀、标题去掉「（备用）」。 */
export type CellGroup = Readonly<{
  key: string
  label: string
  cells: readonly DashboardCell[]
}>

const FALLBACK_SUFFIX = '-fallback'

export function cellGroupsOf(cells: readonly DashboardCell[]): readonly CellGroup[] {
  const groups: CellGroup[] = []
  for (const cell of cells) {
    const baseKey = cell.cellKey.endsWith(FALLBACK_SUFFIX)
      ? cell.cellKey.slice(0, -FALLBACK_SUFFIX.length)
      : cell.cellKey
    const label = cell.label.replace(/（备用）$/, '')
    const found = groups.findIndex((group) => group.key === baseKey)
    if (found === -1) {
      groups.push({ key: baseKey, label, cells: [cell] })
    } else {
      groups[found] = { ...groups[found], cells: [...groups[found].cells, cell] }
    }
  }
  return groups
}

/** 日历按 feed 的 `owner` 分官方 / 聚合；舆情只有一张。判据来自注册表，不在组件里写源 id。 */
export function otherBusinessGroups(
  business: BusinessKey,
  resolveText: (key: string) => string
): readonly CellGroup[] {
  if (business === 'dashboard') return []
  const cells = modulesForBusiness(business).flatMap((module) => module.cells)
  if (business !== 'calendar') return [{ key: business, label: '', cells }]
  const isOfficial = (sourceId: string): boolean =>
    (calendarFeedRegistry as Readonly<Record<string, { owner?: string }>>)[sourceId]?.owner === 'official'
  const groups: CellGroup[] = [
    { key: 'official', label: resolveText('settings.intelligenceSources.calendarGroups.official'), cells: cells.filter((cell) => isOfficial(cell.sourceId)) },
    { key: 'aggregate', label: resolveText('settings.intelligenceSources.calendarGroups.aggregate'), cells: cells.filter((cell) => !isOfficial(cell.sourceId)) }
  ]
  return groups.filter((group) => group.cells.length > 0)
}

export function BusinessSettingsView(props: {
  /** 顶部那条筛选页签（由宿主给）：业务设置下**常显**在左列最上面，和三项列表是上下两层。 */
  tabs?: React.ReactNode
  business: BusinessKey
  onBusinessChange: (business: BusinessKey) => void
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
  /* 只交出**列表本体**：页签条与外层两栏归 `SourcesSettingsPane`（切 tab 不重挂载页签）。 */
  void nameOf
  return <div className="intelligence-catalog-list">
      <div className="business-settings__nav">
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
  </div>
}

/** 右内容区：卡片 / 平铺源名。没有源级详情。 */
export function BusinessSettingsContent(props: {
  business: BusinessKey
  sourceNames: Readonly<Record<string, string>>
  resolveText: (key: string) => string
  /**
   * 格级启停：**注入接口**，真实存储在存储线那边。只回显式写过的格；
   * 缺键的默认值由这一层按行语义定——主源默认开、备用行默认关（用户 2026-11-11：
   * 同一格同一时刻只有一个源在用，所以备用源不该默认为开）。
   */
  isCellEnabled?: (cellId: string) => boolean | undefined
  onCellToggle?: (cellId: string, enabled: boolean) => void
}): React.ReactElement {
  const nameOf = (sourceId: string): string => props.sourceNames[sourceId] ?? sourceId
  const titleKey = `settings.intelligenceSources.businessTabs.${props.business}`
  const renderCell = (
    moduleId: string,
    cell: DashboardCell,
    siblings: readonly string[]
  ): React.ReactElement => {
    const cellId = cellIdOf(moduleId, cell)
    return cellRow({
      cellId,
      enabled: props.isCellEnabled?.(cellId) ?? cell.fallback !== true,
      label: nameOf(cell.sourceId),
      resolveText: props.resolveText,
      siblings,
      sourceId: cell.sourceId,
      ...(props.onCellToggle === undefined ? {} : { onCellToggle: props.onCellToggle })
    })
  }
  return <div className="intelligence-detail-scroll">
    <div className="business-settings__content" data-business-content={props.business}>
      {/* 内容区页头：只写当前业务名，不写副标题、不写「共 N 个」这类统计（用户 2026-11-11）。 */}
      <h3 className="intelligence-section-title">{props.resolveText(titleKey)}</h3>
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
          {module.id === 'ai-analysis'
            ? module.cells.map((cell) => renderCell(module.id, cell, []))
            : <div className="business-cell-grid">
              {/* 两层卡片（用户 2026-11-11）：第一层是模块卡（上面那个 `business-card`），
                  第二层是「数据卡片」——一个格一张卡（`美元`、`纳指`…），卡里放有开关的源项。
                  第二层卡片并排，一行至少 3 张（`grid-template-columns: repeat(3, …)`）。 */}
              {cellGroupsOf(module.cells).map((group) => <div
                className="business-cell"
                data-business-cell-card={group.key}
                data-cell-thin={group.cells.every((cell) => (props.isCellEnabled?.(cellIdOf(module.id, cell)) ?? cell.fallback !== true) === false) ? 'true' : 'false'}
                /* 自适应排布（用户 2026-11-11）：一个格占「源项个数」列，最多 3 列。
                   所以 1 个源的数据卡片占 1/3、2 个源占 2/3——纳指（1 个）能和美元（2 个）并进同一行；
                   放不下时网格自己换行，不做强行合并。 */
                style={{ ['--cell-span' as string]: Math.min(group.cells.length, 3) }}
                key={group.key}>
                <div className="business-cell__title">{group.label}</div>
                <div
                  className="business-cell__items"
                  style={{ ['--cell-items' as string]: Math.min(group.cells.length, 3) }}>
                  {group.cells.map((cell) => renderCell(
                    module.id,
                    cell,
                    group.cells.filter((other) => other !== cell).map((other) => cellIdOf(module.id, other))
                  ))}
                </div>
              </div>)}
            </div>}
        </section>)
        : null}
      {props.business === 'dashboard'
        ? null
        : <section className="business-card" data-business-card={props.business}>
          {/* 日历 / 舆情也是两层卡片（用户 2026-11-11）：模块卡里放第二层数据卡片。
              日历按 `calendarFeedRegistry` 的 `owner` 分「官方源 / 聚合源」两张卡；
              舆情只有一张卡（标题留空，卡头已经写了业务名）。 */}
          <div className="business-cell-grid">
            {otherBusinessGroups(props.business, props.resolveText).map((group) => <div
              className="business-cell"
              data-business-cell-card={group.key}
              key={group.key}
              style={{ ['--cell-span' as string]: Math.min(group.cells.length, 3) }}>
              {group.label === '' ? null : <div className="business-cell__title">{group.label}</div>}
              <div
                className="business-cell__items"
                style={{ ['--cell-items' as string]: Math.min(group.cells.length, 3) }}>
                {group.cells.map((cell) => renderCell(
                  modulesForBusiness(props.business)[0]?.id ?? props.business,
                  cell,
                  []
                ))}
              </div>
            </div>)}
          </div>
        </section>}
    </div>
  </div>
}

/**
 * 卡片里的一行：**行标签是源名** + 行尾的格级开关。
 *
 * 这一行是**纯行**：没有 `onClick`、不是 `<button>`、没有 `role`/`tabIndex`（用户 2026-11-11 取消点击跳转）。
 * 开关管的是「这一格的这个源用不用」，与源自己的采集开关无关；关掉时整行次要化（不隐藏）。
 *
 * **互斥**：同组（同一格）里开一个、其余自动关——一次事件内把同组其它源写 false，
 * 不在界面留「两个源同时开着」的中间态。全关 = 这一格不用。
 */
function cellRow(args: {
  cellId: string
  enabled: boolean
  label: string
  sourceId: string
  siblings: readonly string[]
  onCellToggle?: (cellId: string, enabled: boolean) => void
  resolveText: (key: string) => string
}): React.ReactElement {
  const { cellId, enabled, label, siblings, onCellToggle, sourceId } = args
  const toggleKey = enabled
    ? 'settings.intelligenceSources.cellEnabled.disable'
    : 'settings.intelligenceSources.cellEnabled.enable'
  const onSelect = (next: boolean): void => {
    if (onCellToggle === undefined) return
    if (next) {
      // 同一格只留一个源：先关同组其它源，再开这一个（顺序固定，避免出现同时开着的中间态）。
      for (const sibling of siblings) onCellToggle(sibling, false)
      onCellToggle(cellId, true)
      return
    }
    onCellToggle(cellId, false)
  }
  return <div
    className="business-card__row"
    data-business-row={sourceId}
    data-cell-enabled={enabled ? 'true' : 'false'}
    data-cell-id={cellId}
    key={cellId}>
    <span className="business-card__label">{label}</span>
    {onCellToggle === undefined
      ? null
      : <span className="business-card__toggle">
        <Switch
          aria-label={args.resolveText(toggleKey).replace('{cell}', label)}
          checked={enabled}
          onChange={onSelect}
          size="small" />
      </span>}
  </div>
}
