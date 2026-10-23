import { useState } from 'react'
import { Button } from 'antd'

import type {
  SafeWebSearchProviderView,
  UpdateWebSearchProviderInput,
  WebSearchCapability,
  WebSearchCheckProviderRequest,
  WebSearchCheckProviderResponse,
  WebSearchProviderId,
  WebSearchSettings
} from '@platform/ai/web-search/contracts/webSearchContracts'
import type { PlatformText } from '../../../i18n/platformText'
import { WebSearchProviderDrawer } from './WebSearchProviderDrawer'

type ProviderFilter = 'all' | WebSearchCapability | 'disabled'

type WebSearchProvidersPageProps = {
  labels: PlatformText['webSearch']
  providers: SafeWebSearchProviderView[]
  settings: WebSearchSettings
  openProviderId: WebSearchProviderId | null
  onOpenProvider: (providerId: WebSearchProviderId) => void
  onCloseProvider: () => void
  onSaveProvider: (input: UpdateWebSearchProviderInput) => Promise<void>
  onCheckProvider: (input: WebSearchCheckProviderRequest) => Promise<WebSearchCheckProviderResponse>
  onRevealApiKey: (providerId: WebSearchProviderId) => Promise<string | null>
}

/**
 * PLAT-60 · 供应商页：一行一家（能力在列里），默认列只读，配置走抽屉。
 * 全局策略（压缩/黑名单/最大结果数/默认选择）不在这里。
 */
export function WebSearchProvidersPage({
  labels,
  providers,
  settings,
  openProviderId,
  onOpenProvider,
  onCloseProvider,
  onSaveProvider,
  onCheckProvider,
  onRevealApiKey
}: WebSearchProvidersPageProps): React.ReactElement {
  const [filter, setFilter] = useState<ProviderFilter>('all')
  const [showDeferred, setShowDeferred] = useState(false)
  const implemented = providers
    .filter((provider) => provider.implemented)
    // 原型顺序：已启用的在前，未启用的在后（组内保持供应商预设顺序）。
    .sort((left, right) => Number(right.enabled) - Number(left.enabled))
  const deferred = providers.filter((provider) => !provider.implemented)
  const disabledCount = implemented.filter((provider) => !provider.enabled).length
  const rows = implemented.filter((provider) => matchesFilter(provider, filter))
  const openProvider = providers.find((provider) => provider.id === openProviderId) ?? null

  return (
    <div className="web-search-providers" data-web-search-providers>
      <div className="web-search-provider-filters" role="group" aria-label={labels.providersTab}>
        <FilterChip
          active={filter === 'all'}
          label={labels.providerFiltersAll(implemented.length)}
          filter="all"
          onClick={setFilter}
        />
        <FilterChip
          active={filter === 'searchKeywords'}
          label={labels.providerFilterSearch}
          filter="searchKeywords"
          onClick={setFilter}
        />
        <FilterChip active={filter === 'fetchUrls'} label={labels.providerFilterFetch} filter="fetchUrls" onClick={setFilter} />
        <FilterChip
          active={filter === 'disabled'}
          label={labels.providerFilterDisabled(disabledCount)}
          filter="disabled"
          onClick={setFilter}
        />
      </div>

      <div className="web-search-provider-table-wrap">
        <table className="web-search-provider-table" data-web-search-provider-table>
          <thead>
            <tr>
              <th>{labels.providerTableName}</th>
              <th>{labels.providerTableCapabilities}</th>
              <th>{labels.providerTableStatus}</th>
              <th title={labels.defaultReadonlyHint}>{labels.providerTableDefault}</th>
              <th>{labels.providerTableCredentials}</th>
              <th className="web-search-provider-actions-head" aria-label={labels.configureProvider} />
            </tr>
          </thead>
          <tbody>
            {rows.map((provider) => (
              <tr key={provider.id} data-web-search-provider-row={provider.id}>
                <td className="web-search-provider-name">{provider.name}</td>
                <td>{capabilityText(labels, provider)}</td>
                <td>
                  <span className={provider.enabled ? 'web-search-badge web-search-badge-on' : 'web-search-badge'}>
                    {provider.enabled ? labels.enabled : labels.disabled}
                  </span>
                </td>
                <td data-web-search-default-cell>{defaultBadges(labels, settings, provider)}</td>
                <td>{credentialText(labels, provider)}</td>
                <td className="web-search-provider-row-actions">
                  <Button
                    className="ant-secondary-button"
                    size="small"
                    autoInsertSpace={false}
                    data-web-search-configure={provider.id}
                    onClick={() => onOpenProvider(provider.id)}>
                    {labels.configureProvider}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {deferred.length > 0 ? (
          <button
            type="button"
            className="web-search-providers-more"
            data-web-search-more-providers
            aria-expanded={showDeferred}
            onClick={() => setShowDeferred((current) => !current)}>
            <span>{labels.moreProviders(deferred.length)}</span>
            <span className="web-search-providers-more-caret" aria-hidden="true">
              ›
            </span>
          </button>
        ) : null}
        {showDeferred ? (
          <div className="web-search-deferred-list">
            {deferred.map((provider) => (
              <div key={provider.id} className="web-search-deferred-row" data-web-search-deferred-row={provider.id}>
                <span className="web-search-deferred-name">{provider.name}</span>
                <span>{capabilityText(labels, provider)}</span>
                <span className="web-search-badge">{labels.deferredBadge}</span>
                <span className="web-search-deferred-hint">{labels.deferredProviderHint}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {openProvider ? (
        <WebSearchProviderDrawer
          labels={labels}
          provider={openProvider}
          onClose={onCloseProvider}
          onSave={onSaveProvider}
          onCheck={onCheckProvider}
          onRevealApiKey={onRevealApiKey}
        />
      ) : null}
    </div>
  )
}

function FilterChip({
  active,
  label,
  filter,
  onClick
}: {
  active: boolean
  label: string
  filter: ProviderFilter
  onClick: (filter: ProviderFilter) => void
}): React.ReactElement {
  return (
    <button
      type="button"
      className={active ? 'web-search-filter-chip on' : 'web-search-filter-chip'}
      data-web-search-filter={filter}
      aria-pressed={active}
      onClick={() => onClick(filter)}>
      {label}
    </button>
  )
}

function matchesFilter(provider: SafeWebSearchProviderView, filter: ProviderFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'disabled') return !provider.enabled
  return provider.capabilities.some((capability) => capability.feature === filter)
}

function capabilityText(labels: PlatformText['webSearch'], provider: SafeWebSearchProviderView): string {
  return provider.capabilities
    .map((capability) =>
      capability.feature === 'searchKeywords' ? labels.capabilitySearchShort : labels.capabilityFetchShort
    )
    .join(labels.capabilityJoin)
}

function defaultBadges(
  labels: PlatformText['webSearch'],
  settings: WebSearchSettings,
  provider: SafeWebSearchProviderView
): React.ReactNode {
  const badges: string[] = []
  if (settings.defaultSearchProviderId === provider.id) badges.push(labels.defaultSearchBadge)
  if (settings.defaultFetchProviderId === provider.id) badges.push(labels.defaultFetchBadge)
  if (badges.length === 0) return <span className="web-search-default-none">—</span>
  return badges.map((badge) => (
    <span key={badge} className="web-search-badge web-search-badge-default">
      {badge}
    </span>
  ))
}

function credentialText(labels: PlatformText['webSearch'], provider: SafeWebSearchProviderView): string {
  if (provider.id === 'fetch') return labels.credentialNone
  if (provider.id === 'searxng') {
    return provider.hasBasicAuth ? labels.credentialBasicSaved : labels.credentialBasicMissing
  }
  return provider.hasApiKey ? labels.credentialKeySaved(provider.apiKeyLength) : labels.credentialKeyMissing
}
