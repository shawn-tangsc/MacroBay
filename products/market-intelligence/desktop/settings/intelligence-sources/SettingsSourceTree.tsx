import { ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'

import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'

import { useProductTextKey } from '../../shared/i18n/productTextKey'
import { calendarFeedRegistry } from '../../../service/intelligence/macro-calendar/calendarFeedRegistry'
import { DASHBOARD_TAB_MODULES, modulesUsingSource } from './dashboardSourceModules'
import { SettingsInfo } from '../settingsInfo'
import { catalogMarkerClass } from './sourceHealthTone'
import { SourceFilterTabs } from './filter/SourceFilterTabs'

import type { SettingsView } from '../../../service/intelligence/application/sourceProjection'
import type { SourceCategory } from '../../../service/intelligence/application/providerRegistry'

export type SourceFilter = 'all' | 'calendar' | 'dashboard' | 'sentiment' | 'pending' | 'advanced' | 'other'

type Labels = {
  title: string
  categories: Record<SourceCategory, string>
  providerNames: Record<string, string>
  /** 「含 {count} 个不可用的源」：只进目录行的可访问名，不在屏幕上多画一行。单复数是两个键。 */
  unavailableCountOne: string
  unavailableCountOther: string
}

/** One list, so the visible order and the option values cannot drift apart. */
const FILTERS: ReadonlyArray<{ value: SourceFilter; labelKey: string }> = [
  { value: 'all', labelKey: 'settings.intelligenceSources.sourceFilters.all' },
  { value: 'calendar', labelKey: 'settings.intelligenceSources.sourceFilters.calendar' },
  { value: 'dashboard', labelKey: 'settings.intelligenceSources.sourceFilters.dashboard' },
  { value: 'sentiment', labelKey: 'settings.intelligenceSources.sourceFilters.sentiment' },
  { value: 'pending', labelKey: 'settings.intelligenceSources.sourceFilters.pending' },
  { value: 'advanced', labelKey: 'settings.intelligenceSources.sourceFilters.advanced' }
]

/**
 * 「舆情」按**用途**判，不按面板：`panels` 是面板路由（只由 dashboard / calendar 映射出来），
 * `sentiment` 本来就没有对应面板。把 sentiment 塞进 `panels` 会让「出现在哪个面板」和
 * 「这个源供什么用途」混成一个语义，别处按 panels 做的判断都会被牵连——所以这里读 `purposes`。
 */
export function sourceMatchesFilter(
  source: { panels: readonly string[]; visibility: string; kind: string; purposes?: readonly string[] },
  filter: SourceFilter
): boolean {
  if (filter === 'calendar') return source.kind === 'official-calendar' || source.kind === 'market-calendar'
  if (filter === 'dashboard') return source.panels.includes('dashboard')
  if (filter === 'sentiment') return (source.purposes ?? []).includes('sentiment')
  if (filter === 'pending') return source.visibility === 'pending'
  if (filter === 'advanced') return source.visibility === 'advanced'
  /* 「其他」是**兜底**：不属于看板 / 日历 / 舆情的源都归它（pending、advanced、只供分析、维护备用）。
     它不是「待接入」——那 4 个只供分析的源是正常可用的，说成「待接入」就是假话（同「读不到 ≠ 没有」）。
     设置页那份不加这一块，那边的「待接入」仍是 pending 原义。 */
  if (filter === 'other') {
    // 只收「有真实用途或需要读者配置」的源：4 个只供分析的、pending 待接入的、只进简报的。
    // **维护备用源（purposes 为空且不是 pending）不进抽屉**——它们今天没有读者可见产出，
    // 也没有待配的意义，留在设置页仍可见可开关。这不是「被误筛掉」，是明确按 purposes 为空排除。
    const purposes = source.purposes ?? []
    if (purposes.length === 0 && source.visibility !== 'pending') return false
    return !sourceMatchesFilter(source, 'dashboard')
      && !sourceMatchesFilter(source, 'calendar')
      && !sourceMatchesFilter(source, 'sentiment')
  }
  return true
}

const matchesFilter = sourceMatchesFilter

/** 行状态：`enabled`（有模块用且至少一项开）/ `disabled`（有模块用但全关）/ `unused`（0 模块或待接入）。 */
export function providerRowState(provider: { sources: ReadonlyArray<{ sourceId: string; enabled: boolean; visibility: string }> }): 'enabled' | 'disabled' | 'unused' {
  const used = provider.sources.some((source) => modulesUsingSource(source.sourceId).length > 0)
  if (!used || provider.sources.every((source) => source.visibility === 'pending')) return 'unused'
  return provider.sources.some((source) => source.enabled) ? 'enabled' : 'disabled'
}

/**
 * 组内排序（用户 2026-11-11）：enabled → disabled → unused；**同级保持原顺序**（稳定的数组排序，
 * 不每次渲染抖）。只排组内，不跨组。
 */
const STATE_ORDER: Record<ReturnType<typeof providerRowState>, number> = { enabled: 0, disabled: 1, unused: 2 }

function sortByState<T extends { sources: ReadonlyArray<{ sourceId: string; enabled: boolean; visibility: string }> }>(providers: readonly T[]): T[] {
  return [...providers].sort((left, right) => STATE_ORDER[providerRowState(left)] - STATE_ORDER[providerRowState(right)])
}

/**
 * 「日历」那一屏的组别：**官方源 / 聚合源**，判据是 `calendarFeedRegistry` 的 `owner`，
 * 不在组件里写源 id、源名或一张手抄表（用户 2026-11-10）。
 *
 * - 官方源 = `owner: 'official'`（Fed / BEA / BLS）；
 * - 聚合源 = 其余日历源：0xRouter 三条是 `market`，CoinMarketCal 是 `pending`——**它只是还没接入，
 *   仍是聚合商**，不许因为 pending 单独开一组或藏起来。
 */
const CALENDAR_GROUP_KEYS = {
  official: 'settings.intelligenceSources.calendarGroups.official',
  aggregate: 'settings.intelligenceSources.calendarGroups.aggregate'
} as const

function isOfficialCalendarSource(sourceId: string): boolean {
  return (calendarFeedRegistry as Readonly<Record<string, { owner?: string }>>)[sourceId]?.owner === 'official'
}

/** One flat row per provider; capabilities live in the detail pane. */
export function SettingsSourceTree({ bare, filter, filters, flat, labels, onFilterChange, onSelectProvider, selectedProviderId, view }: {
  /** 只交**列表本体**（不画外层栏与页签）：页签条由 `SourcesSettingsPane` 统一画，切 tab 才不重挂载。 */
  bare?: boolean
  /**
   * 平铺、**不分组**：`数据源` 那一屏就是一条列表（用户 2026-11-11「都没有分组了」）。
   * 全部可见源都在，按 绿 → 红 → 灰 排序，同级保持原顺序。
   */
  flat?: boolean
  filter: SourceFilter
  /** 这一面显示哪几块筛选：设置页默认六项；抽屉只传四块（日历 / 看板 / 舆情 / 待接入）。 */
  filters?: ReadonlyArray<{ value: SourceFilter; labelKey: string }>
  labels: Labels
  onFilterChange: (filter: SourceFilter) => void
  onSelectProvider: (providerId: string) => void
  selectedProviderId?: string
  view?: SettingsView
}): React.ReactElement {
  const resolveText = useProductTextKey()
  const visibleFilters = filters ?? FILTERS
  /**
   * 列表形态（C5）：默认分组；**只有「看板」这一档自动平铺**，其余几档保持默认的分组形态
   * （舆情 / 待接入 / 进阶本来就不画组头，但那是分组维度的平铺，不是网格）。状态留住是为了
   * 将来给读者一个显式开关时不必改结构，现在它只由 `filter` 驱动。
   */
  const [mode, setMode] = useState<'grouped' | 'tiles'>('grouped')
  useEffect(() => { setMode(filter === 'dashboard' ? 'tiles' : 'grouped') }, [filter])
  /**
   * 这一面怎么分组，只看**当前这个筛选**：
   * - `全部` → 按注册表的 provider 分类（宏观 / 加密市场 / 聚合数据供应商）；
   * - `日历` → 按 `calendarFeedRegistry` 的 `owner`：官方源 / 聚合源；
   * - 看板 / 舆情 / 待接入 / 其他 → **平铺**，不套那三分组、也不自造新组（用户 2026-11-10）。
   */
  const matchingProviders = (view?.groups ?? [])
    .flatMap((group) => group.providers)
    .map((provider) => ({ ...provider, sources: provider.sources.filter((source) => matchesFilter(source, filter)) }))
    .filter((provider) => provider.sources.length > 0)
  const byCalendarOwner = (official: boolean) => matchingProviders
    .map((provider) => ({
      ...provider,
      sources: provider.sources.filter((source) => isOfficialCalendarSource(source.sourceId) === official)
    }))
    .filter((provider) => provider.sources.length > 0)
  const sections: ReadonlyArray<{
    key: string
    title?: string
    providers: typeof matchingProviders
    info?: Readonly<{ ariaLabelKey: string; noteKey: string }>
  }> = filter === 'calendar'
    ? [
      { key: 'official', title: resolveText(CALENDAR_GROUP_KEYS.official), providers: byCalendarOwner(true) },
      { key: 'aggregate', title: resolveText(CALENDAR_GROUP_KEYS.aggregate), providers: byCalendarOwner(false) }
    ]
    : filter === 'all'
      ? (view?.groups ?? []).map((group) => ({
        key: group.category,
        title: labels.categories[group.category],
        providers: group.providers
          .map((provider) => ({ ...provider, sources: provider.sources.filter((source) => matchesFilter(source, filter)) }))
          .filter((provider) => provider.sources.length > 0)
      }))
      : filter === 'dashboard'
        /* 看板：按**模块**分组（顺序照清单），一个源被多个模块共用就在每个模块下各出现一次；
           不属于任何模块的源（维护备用 / 未接入 / 只标了 analysis 用途的那几条）在看板页签里不出现。 */
        ? DASHBOARD_TAB_MODULES.map((module) => ({
          key: module.id,
          title: resolveText(module.labelKey),
          providers: matchingProviders
            .map((provider) => ({
              ...provider,
              sources: provider.sources.filter((source) => module.sourceIds.includes(source.sourceId))
            }))
            .filter((provider) => provider.sources.length > 0)
        }))
        : [{ key: 'flat', providers: matchingProviders }]
  const list = <div
    className={`intelligence-catalog-list${mode === 'tiles' ? ' intelligence-catalog-list--tiles' : ''}`}
    data-list-mode={mode}>
      {/* A filter that hides every provider must say so and offer the way back, not render blank.
          **未结算不是「被筛掉了」**：`view` 还没到时不能画这个空态——空数组的 `every` 恒真，
          任何新调用点提前渲染都会立刻误导成「筛选后没有来源」。 */}
      {view !== undefined && view.groups.every((group) => group.providers.every((provider) => provider.sources.filter((source) => matchesFilter(source, filter)).length === 0))
        ? <StateView
          /* `filtered-out` 必须给一个动作（StateView 的调用点守卫会红）。有「全部」就回「全部」；
             四块那一面没有「全部」，就回第一块（抽屉里是「看板」，也是默认值）——不会落到不存在的档位。 */
          action={{
            labelKey: STATE_VIEW_ACTION_KEYS.clear_filter,
            onSelect: () => onFilterChange(visibleFilters.some((entry) => entry.value === 'all') ? 'all' : visibleFilters[0].value)
          }}
          reasonCode="filtered-out"
          size="md"
          state="empty"
        />
        : null}
      {sections.map((section) => {
        /* 这里按**源**筛掉空行：供应商行只在它旗下至少有一个匹配源时才出现。
           一条容易误会的推论是「我在待接入里看到过它」——待接入显示的是**供应商行**
           （供应商旗下有一个 pending 源，整行就会出现），不等于那个源本身在待接入里。
           判断某个源在哪一块可见，要按它的 `visibility` / `panels` / `purposes` 算，不要按供应商名。 */
        const providers = section.providers
        if (providers.length === 0) return null
        return <div className="intelligence-catalog-group" key={section.key}>
          {/* 空组不显示标题；平铺那一面（看板 / 舆情 / 待接入 / 其他）干脆没有标题。 */}
          {section.title === undefined
            ? null
            : <div className="intelligence-catalog-group-title">
              {section.title}
              {section.info === undefined
                ? null
                : <SettingsInfo
                  ariaLabelKey={section.info.ariaLabelKey}
                  labelKeys={[section.info.noteKey]}
                  resolveText={resolveText} />}
            </div>}
          {sortByState(providers).map((provider) => {
            // 标记档由投影给出，与抽屉读同一份（组件不看 enabled/unavailable）。
            const markerClass = catalogMarkerClass(provider.healthMarker)
            // ring 是装饰（aria-hidden），读屏听不到「取不到」——把数量补进这一行的可访问名。
            const unavailableCount = provider.sources.filter((source) => source.enabled && source.unavailable !== undefined).length
            const unavailableCountText = unavailableCount === 1 ? labels.unavailableCountOne : labels.unavailableCountOther
            return <section className="intelligence-provider-group" key={provider.providerId}>
              {/* 例外登记（ui-spec R1）：这是**两行内容 + 选中态的行容器**，不是命令按钮。
                  antd `Button` 会把子节点包进自己的 span 并带 padding/height，可见形状会变，
                  所以保留原生按钮、不覆写内联样式去模拟；可访问语义补齐：名字取行内文本、
                  键盘可达（原生按钮）、选中态用 `aria-current`。 */}
              <button
                aria-current={provider.providerId === selectedProviderId ? 'true' : undefined}
                /* 行状态只给**头像**上色：待接入（优先）→ 灰、全关 → 红、至少一项启用 → 绿。
                   源名与副标题的文字色不跟状态走（用户 2026-11-11）。 */
                data-provider-state={providerRowState(provider) === 'unused' ? 'pending' : providerRowState(provider)}
                className={`intelligence-provider-row${provider.providerId === selectedProviderId ? ' selected' : ''}`}
                type="button"
                onClick={() => onSelectProvider(provider.providerId)}
              >
                <span className={`intelligence-source-avatar${provider.sources.every((source) => source.panels.length === 0) ? ' is-unused' : ''}`} aria-hidden="true">
                  {(labels.providerNames[provider.providerId] ?? provider.displayName).slice(0, 1).toUpperCase()}
                </span>
                <span className="intelligence-provider-main">
                  <strong>{labels.providerNames[provider.providerId] ?? provider.displayName}</strong>
                </span>
                {unavailableCount > 0
                  ? <span className="intelligence-source-sr-only">{unavailableCountText.replace('{count}', String(unavailableCount))}</span>
                  : null}
                <span className="intelligence-provider-state">
                  {markerClass === undefined ? null : <i className={markerClass} aria-hidden="true" />}
                  <ChevronRight aria-hidden="true" size={13} />
                </span>
              </button>
            </section>
          })}
        </div>
      })}
  </div>
  if (bare === true) return list
  return <aside className="intelligence-catalog-pane intelligence-catalog-pane--filtered">
    <div className="intelligence-catalog-filters">
      <SourceFilterTabs
        labels={{
          group: resolveText('settings.intelligenceSources.sourceFilterLabel'),
          items: visibleFilters.map((entry) => ({ value: entry.value, label: resolveText(entry.labelKey) }))
        }}
        onTab={(value) => onFilterChange(value as SourceFilter)}
        tab={filter}
      />
    </div>
    {list}
  </aside>
}
