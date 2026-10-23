import { AlertTriangle } from 'lucide-react'

import type {
  SafeWebSearchProviderView,
  WebSearchCapability,
  WebSearchProviderId,
  WebSearchSettings
} from '@platform/ai/web-search/contracts/webSearchContracts'
import type { PlatformText } from '../../../i18n/platformText'
import { resolveWebSearchAvailability } from './webSearchAvailability'

type WebSearchSummaryChipsProps = {
  labels: PlatformText['webSearch']
  settings: WebSearchSettings
  providers: SafeWebSearchProviderView[]
  onSelectProvider: (id: WebSearchProviderId) => void
}

/**
 * PLAT-60：两页共用的一行「当前生效」摘要（顺序与原型一致）。
 * 只读已保存的 settings，不读草稿，避免把尚未保存的值说成已生效。
 */
export function WebSearchSummaryChips({
  labels,
  settings,
  providers,
  onSelectProvider
}: WebSearchSummaryChipsProps): React.ReactElement {
  const unit = settings.compression.cutoffUnit === 'char' ? labels.cutoffChars : labels.cutoffTokens
  const search = resolveWebSearchAvailability(labels, settings, providers, 'searchKeywords')
  const fetch = resolveWebSearchAvailability(labels, settings, providers, 'fetchUrls')

  return (
    <div className="web-search-summary" data-web-search-summary>
      {search.available ? (
        <SummaryChip label={labels.summaryDefaultSearch} value={providerName(providers, settings.defaultSearchProviderId)} />
      ) : (
        <SummaryWarning
          capability="searchKeywords"
          message={search.message}
          onClick={() => onSelectProvider(search.providerId)}
        />
      )}
      {fetch.available ? (
        <SummaryChip label={labels.summaryFetch} value={providerName(providers, settings.defaultFetchProviderId)} />
      ) : (
        <SummaryWarning capability="fetchUrls" message={fetch.message} onClick={() => onSelectProvider(fetch.providerId)} />
      )}
      <SummaryChip label={labels.summaryMaxResults} value={`${settings.maxResults} ${labels.summaryResultUnit}`} />
      <SummaryChip label={labels.summaryCutoff} value={`${settings.compression.cutoffLimit} ${unit}`} />
      <SummaryChip
        label={labels.summaryBlacklist}
        value={`${settings.excludeDomains.length} ${labels.summaryBlacklistUnit}`}
      />
      <SummaryChip
        label={labels.summaryWithDate}
        value={settings.searchWithDate ? labels.summaryOn : labels.summaryOff}
      />
    </div>
  )
}

function SummaryChip({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <span className="web-search-summary-chip" data-web-search-summary-chip>
      {label} <b>{value}</b>
    </span>
  )
}

function SummaryWarning({
  capability,
  message,
  onClick
}: {
  capability: WebSearchCapability
  message: string
  onClick: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      className="web-search-summary-chip web-search-summary-warning"
      data-web-search-summary-chip
      data-web-search-summary-warning={capability}
      onClick={onClick}>
      <AlertTriangle size={12} aria-hidden="true" />
      {message}
    </button>
  )
}

function providerName(providers: SafeWebSearchProviderView[], id: WebSearchProviderId): string {
  return providers.find((provider) => provider.id === id)?.name ?? id
}
