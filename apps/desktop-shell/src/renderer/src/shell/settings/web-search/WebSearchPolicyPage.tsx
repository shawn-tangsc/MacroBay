import { InputNumber, Select, Switch } from 'antd'

import type {
  SafeWebSearchProviderView,
  WebSearchCapability,
  WebSearchProviderId,
  WebSearchSettings
} from '@platform/ai/web-search/contracts/webSearchContracts'
import type { PlatformText } from '../../../i18n/platformText'
import { WebSearchBlacklistSettings } from './WebSearchBlacklistSettings'
import { WebSearchCompressionSettings } from './WebSearchCompressionSettings'
import { WebSearchFormRow } from './WebSearchFormGrid'
import {
  resolveWebSearchProviderOption,
  type WebSearchProviderOptionReason
} from './webSearchAvailability'

type WebSearchPolicyPageProps = {
  labels: PlatformText['webSearch']
  settings: WebSearchSettings
  providers: SafeWebSearchProviderView[]
  onChange: (patch: Partial<WebSearchSettings>) => void
}

type ProviderOption = {
  value: WebSearchProviderId
  label: string
  disabled: boolean
}

/**
 * PLAT-60 · 策略页：只放全局行为（默认谁、结果多少、怎么裁、屏蔽谁）。
 * 供应商凭据 / 端点 / 启用开关不在这里。
 */
export function WebSearchPolicyPage({
  labels,
  settings,
  providers,
  onChange
}: WebSearchPolicyPageProps): React.ReactElement {
  const searchOptions = providerOptions(labels, settings, providers, 'searchKeywords')
  const fetchOptions = providerOptions(labels, settings, providers, 'fetchUrls')

  return (
    <div className="web-search-policy" data-web-search-policy>
      <section className="web-search-settings-card">
        <div className="section-heading">
          <span>{labels.defaultProvidersSection}</span>
        </div>
        <div className="web-search-form">
          <WebSearchFormRow label={labels.defaultSearchRow} hint={labels.defaultProvidersHint}>
            <div data-web-search-default-select="searchKeywords">
              <Select
                value={settings.defaultSearchProviderId}
                options={searchOptions}
                onChange={(defaultSearchProviderId: WebSearchProviderId) =>
                  onChange({ defaultSearchProviderId })
                }
              />
            </div>
          </WebSearchFormRow>
          <WebSearchFormRow label={labels.defaultFetchRow} hint={labels.defaultFetchProviderHint}>
            <div data-web-search-default-select="fetchUrls">
              <Select
                value={settings.defaultFetchProviderId}
                options={fetchOptions}
                onChange={(defaultFetchProviderId: WebSearchProviderId) => onChange({ defaultFetchProviderId })}
              />
            </div>
          </WebSearchFormRow>
        </div>
      </section>

      <section className="web-search-settings-card">
        <div className="section-heading">
          <span>{labels.resultsSection}</span>
        </div>
        <div className="web-search-form">
          <WebSearchFormRow label={labels.maxResults} hint={labels.maxResultsHint}>
            <InputNumber
              className="web-search-input-narrow"
              min={1}
              max={10}
              value={settings.maxResults}
              onChange={(maxResults) =>
                onChange({ maxResults: typeof maxResults === 'number' ? maxResults : settings.maxResults })
              }
            />
          </WebSearchFormRow>
          <WebSearchFormRow label={labels.searchWithDate} hint={labels.searchWithDateHint}>
            <Switch
              checked={settings.searchWithDate}
              onChange={(searchWithDate) => onChange({ searchWithDate })}
            />
          </WebSearchFormRow>
        </div>
      </section>

      <WebSearchCompressionSettings
        labels={labels}
        value={settings.compression}
        onChange={(compression) => onChange({ compression })}
      />
      <WebSearchBlacklistSettings
        labels={labels}
        value={settings.excludeDomains}
        onChange={(excludeDomains) => onChange({ excludeDomains })}
      />
    </div>
  )
}

function providerOptions(
  labels: PlatformText['webSearch'],
  settings: WebSearchSettings,
  providers: SafeWebSearchProviderView[],
  capability: WebSearchCapability
): ProviderOption[] {
  const candidates = providers
    .filter((provider) => provider.capabilities.some((item) => item.feature === capability))
    .map((provider) => ({
      provider,
      state: resolveWebSearchProviderOption(settings, provider, capability)
    }))
  // 可选的排在前面（原型里 Tavily/Jina 在前），置灰项保留并注明原因。
  const ordered = [...candidates.filter((item) => item.state.selectable), ...candidates.filter((item) => !item.state.selectable)]
  return ordered.map(({ provider, state }) => ({
    value: provider.id,
    label: state.selectable
      ? provider.name
      : labels.providerOptionReason(provider.name, reasonText(labels, state.reason)),
    disabled: !state.selectable
  }))
}

function reasonText(labels: PlatformText['webSearch'], reason: WebSearchProviderOptionReason): string {
  if (reason === 'missingKey') return labels.optionMissingKey
  if (reason === 'deferred') return labels.deferredBadge
  return labels.disabled
}
