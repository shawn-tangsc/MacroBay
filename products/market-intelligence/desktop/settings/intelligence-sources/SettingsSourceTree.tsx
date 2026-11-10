import { ChevronRight } from 'lucide-react'

import { Segmented } from '@platform/ui/components/segmented'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'

import { useProductTextKey } from '../../shared/i18n/productTextKey'
import { catalogMarkerClass } from './sourceHealthTone'

import type { SettingsView } from '../../../service/intelligence/application/sourceProjection'
import type { SourceCategory } from '../../../service/intelligence/application/providerRegistry'

export type SourceFilter = 'all' | 'calendar' | 'dashboard' | 'sentiment' | 'pending' | 'advanced' | 'other'

type Labels = {
  title: string
  categories: Record<SourceCategory, string>
  providerNames: Record<string, string>
  providerSummary: string
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

/** One flat row per provider; capabilities live in the detail pane. */
export function SettingsSourceTree({ filter, filters, labels, onFilterChange, onSelectProvider, selectedProviderId, view }: {
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
  return <aside className="intelligence-catalog-pane intelligence-catalog-pane--filtered">
    <div className="intelligence-catalog-filters">
      {/* One Tab reaches the group; the arrow keys move focus and Enter/Space picks, so a reader can
          look through the filters before committing. Every label and the group's own name are keys,
          so this file holds no sentences. */}
      <Segmented
        ariaLabelKey="settings.intelligenceSources.sourceFilterLabel"
        items={visibleFilters}
        onChange={(value) => onFilterChange(value as SourceFilter)}
        resolveText={resolveText}
        value={filter}
      />
    </div>
    <div className="intelligence-catalog-list">
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
      {(view?.groups ?? []).map((group) => {
        const providers = group.providers
          .map((provider) => ({ ...provider, sources: provider.sources.filter((source) => matchesFilter(source, filter)) }))
          .filter((provider) => provider.sources.length > 0)
        if (providers.length === 0) return null
        return <div className="intelligence-catalog-group" key={group.category}>
          <div className="intelligence-catalog-group-title">{labels.categories[group.category]}</div>
          {providers.map((provider) => {
            const enabled = provider.sources.filter((source) => source.enabled).length
            const summary = labels.providerSummary.replace('{total}', String(provider.sources.length)).replace('{enabled}', String(enabled))
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
                className={`intelligence-provider-row${provider.providerId === selectedProviderId ? ' selected' : ''}`}
                type="button"
                onClick={() => onSelectProvider(provider.providerId)}
              >
                <span className={`intelligence-source-avatar${provider.sources.every((source) => source.panels.length === 0) ? ' is-unused' : ''}`} aria-hidden="true">
                  {(labels.providerNames[provider.providerId] ?? provider.displayName).slice(0, 1).toUpperCase()}
                </span>
                <span className="intelligence-provider-main">
                  <strong>{labels.providerNames[provider.providerId] ?? provider.displayName}</strong>
                  <small>{summary}</small>
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
  </aside>
}
