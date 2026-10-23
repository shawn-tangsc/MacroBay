import { ChevronRight } from 'lucide-react'

import type { SettingsView } from '../../../service/intelligence/application/sourceProjection'
import type { SourceCategory } from '../../../service/intelligence/application/providerRegistry'

export type SourceFilter = 'all' | 'calendar' | 'dashboard' | 'pending' | 'advanced'

type Labels = {
  title: string
  categories: Record<SourceCategory, string>
  filters: Record<SourceFilter, string>
  providerNames: Record<string, string>
  providerSummary: string
}

const filterOrder: SourceFilter[] = ['all', 'calendar', 'dashboard', 'pending', 'advanced']

function matchesFilter(source: { panels: readonly string[]; visibility: string; kind: string }, filter: SourceFilter): boolean {
  if (filter === 'calendar') return source.kind === 'official-calendar' || source.kind === 'market-calendar'
  if (filter === 'dashboard') return source.panels.includes('dashboard')
  if (filter === 'pending') return source.visibility === 'pending'
  if (filter === 'advanced') return source.visibility === 'advanced'
  return true
}

/** One flat row per provider; capabilities live in the detail pane. */
export function SettingsSourceTree({ filter, labels, onFilterChange, onSelectProvider, selectedProviderId, view }: {
  filter: SourceFilter
  labels: Labels
  onFilterChange: (filter: SourceFilter) => void
  onSelectProvider: (providerId: string) => void
  selectedProviderId?: string
  view?: SettingsView
}): React.ReactElement {
  return <aside className="intelligence-catalog-pane intelligence-catalog-pane--filtered">
    <div className="intelligence-catalog-filters" role="tablist">
      {filterOrder.map((item) => <button
        aria-selected={item === filter}
        className={`intelligence-catalog-filter${item === filter ? ' selected' : ''}`}
        key={item}
        role="tab"
        type="button"
        onClick={() => onFilterChange(item)}
      >{labels.filters[item]}</button>)}
    </div>
    <div className="intelligence-catalog-list">
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
            return <section className="intelligence-provider-group" key={provider.providerId}>
              <button
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
                <span className="intelligence-provider-state">
                  <i className={enabled > 0 ? 'is-on' : ''} aria-hidden="true" />
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
