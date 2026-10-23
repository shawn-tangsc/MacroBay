import { Button, Drawer, Input, Switch } from 'antd'
import { Check } from 'lucide-react'

import type {
  SafeWebSearchProviderView,
  UpdateWebSearchProviderInput,
  WebSearchCapability,
  WebSearchCheckProviderRequest,
  WebSearchCheckProviderResponse
} from '@platform/ai/web-search/contracts/webSearchContracts'
import type { PlatformText } from '../../../i18n/platformText'
import { WebSearchApiKeyField } from './WebSearchApiKeyField'
import { WebSearchFormRow } from './WebSearchFormGrid'
import { useProviderSettingsDraft } from './useProviderSettingsDraft'

type WebSearchProviderDrawerProps = {
  labels: PlatformText['webSearch']
  provider: SafeWebSearchProviderView
  onClose: () => void
  onSave: (input: UpdateWebSearchProviderInput) => Promise<void>
  onCheck: (input: WebSearchCheckProviderRequest) => Promise<WebSearchCheckProviderResponse>
  onRevealApiKey: (providerId: SafeWebSearchProviderView['id']) => Promise<string | null>
}

/**
 * PLAT-60 · 供应商抽屉（只负责连接与凭据）。
 * 顺序按原型：启用开关 → 端点 → API Key（仅 tavily/jina）→ Basic Auth（仅 searxng）→ 检查/保存。
 * 压缩、黑名单、最大结果数、默认能力一律不在抽屉里。
 */
export function WebSearchProviderDrawer({
  labels,
  provider,
  onClose,
  onSave,
  onCheck,
  onRevealApiKey
}: WebSearchProviderDrawerProps): React.ReactElement {
  const draft = useProviderSettingsDraft({ labels, provider, onSave, onCheck })
  const isSearxng = provider.id === 'searxng'
  const isFetch = provider.id === 'fetch'
  const showApiKeyField = provider.id === 'tavily' || provider.id === 'jina'
  const capabilities = provider.capabilities
    .map((capability) => formatCapabilityShort(labels, capability.feature))
    .join(labels.capabilityJoin)

  return (
    <Drawer
      className="model-drawer web-search-provider-drawer"
      rootClassName="web-search-provider-drawer-root"
      width="min(520px, 46vw)"
      placement="right"
      mask
      keyboard
      maskClosable
      open
      onClose={onClose}
      title={
        <span className="web-search-drawer-title">
          <strong>{labels.drawerTitle(provider.name)}</strong>
          <span className="web-search-badge" data-web-search-drawer-capabilities>
            {capabilities}
          </span>
        </span>
      }
      extra={<span className="web-search-drawer-readonly">{labels.drawerDefaultHint}</span>}
      footer={
        <div className="drawer-actions drawer-actions-split">
          <Button
            className="ant-secondary-button"
            loading={draft.checking}
            disabled={!provider.implemented}
            onClick={() => void draft.check()}>
            {draft.checking ? labels.checkingProvider : labels.checkProvider}
          </Button>
          <Button
            className="ant-primary-button"
            loading={draft.saving}
            disabled={!provider.implemented || !draft.dirty || draft.saving}
            icon={<Check size={14} />}
            onClick={() => void draft.saveText()}>
            {labels.saveKeyAndAdvanced}
          </Button>
        </div>
      }>
      <div className="web-search-drawer-body">
        <WebSearchFormRow label={labels.enableProvider}>
          <Switch
            data-web-search-provider-enable
            checked={draft.enabled}
            loading={draft.toggleSaving}
            disabled={!provider.implemented || draft.toggleSaving}
            onChange={(next) => void draft.toggleEnabled(next)}
          />
        </WebSearchFormRow>

        {isFetch ? (
          <p className="web-search-drawer-note">{labels.fetchApiHostNote}</p>
        ) : (
          provider.capabilities.map((capability) => (
            <WebSearchFormRow
              key={capability.feature}
              label={`${labels.endpoint}${labels.capabilityJoin}${formatCapabilityShort(labels, capability.feature)}`}
              hint={isSearxng ? undefined : labels.builtinApiHost}>
              {isSearxng ? (
                <Input
                  data-web-search-endpoint={capability.feature}
                  value={draft.apiHostByCapability[capability.feature] ?? capability.apiHost ?? ''}
                  disabled={!provider.implemented || !capability.apiHost}
                  onChange={(event) =>
                    draft.setApiHostByCapability((current) => ({
                      ...current,
                      [capability.feature]: event.target.value
                    }))
                  }
                />
              ) : (
                <code className="web-search-endpoint-readonly" data-web-search-endpoint={capability.feature}>
                  {draft.apiHostByCapability[capability.feature] ?? capability.apiHost ?? ''}
                </code>
              )}
            </WebSearchFormRow>
          ))
        )}

        {showApiKeyField ? (
          <WebSearchFormRow label={labels.apiKey}>
            <WebSearchApiKeyField
              labels={labels}
              hasApiKey={provider.hasApiKey}
              apiKeyPreview={provider.apiKeyPreview}
              value={draft.apiKey}
              disabled={!provider.implemented}
              onChange={draft.setApiKey}
              onReveal={() => onRevealApiKey(provider.id)}
              onRemove={draft.removeApiKey}
              apiKeyLength={provider.apiKeyLength}
              hideLabel
            />
            {draft.checkErrorCode === 'provider_unauthorized' ? (
              <p className="web-search-drawer-note web-search-drawer-error">
                {provider.apiKeyLength
                  ? labels.invalidApiKeyWithLength(draft.checkStatus ?? 401, provider.apiKeyLength)
                  : labels.invalidApiKeyCheckHint}
              </p>
            ) : null}
          </WebSearchFormRow>
        ) : null}

        {isSearxng ? (
          <>
            <WebSearchFormRow label={labels.engines} hint={labels.enginesPlaceholder}>
              <Input
                value={draft.engines}
                disabled={!provider.implemented}
                placeholder={labels.enginesPlaceholder}
                onChange={(event) => draft.setEngines(event.target.value)}
              />
            </WebSearchFormRow>
            <WebSearchFormRow label={labels.basicAuthUsername}>
              <Input
                value={draft.basicAuthUsername}
                disabled={!provider.implemented}
                onChange={(event) => draft.setBasicAuthUsername(event.target.value)}
              />
            </WebSearchFormRow>
            <WebSearchFormRow label={labels.basicAuthPassword}>
              <Input.Password
                value={draft.basicAuthPassword}
                disabled={!provider.implemented}
                onChange={(event) => draft.setBasicAuthPassword(event.target.value)}
              />
            </WebSearchFormRow>
          </>
        ) : null}

        {!provider.implemented ? <p className="web-search-drawer-note">{labels.providerDisabledHint}</p> : null}
        {draft.status && draft.checkErrorCode !== 'provider_unauthorized' ? (
          <p className="web-search-drawer-note">{draft.status}</p>
        ) : null}
      </div>
    </Drawer>
  )
}

function formatCapabilityShort(labels: PlatformText['webSearch'], capability: WebSearchCapability): string {
  return capability === 'searchKeywords' ? labels.capabilitySearchShort : labels.capabilityFetchShort
}
