import { resolveProviderChatBase } from '@platform/ai/providers/providerChatEndpoints'
import type { AppSettings } from '@platform/settings/schema/appSettings'

import type { PlatformText } from '../../i18n/platformText'
import { resolveProviderHost } from './ModelServiceBrandBlock'
import { resolveProviderDisplayName } from './providerDisplayName'
import { ProviderConnectionCheckDrawer } from '../ProviderConnectionCheckDrawer'
import { ProviderModelSyncDrawer } from '../ProviderModelSyncDrawer'
import type { ModelServiceActions } from './useModelServiceActions'
import type { ModelServiceDrafts } from './useModelServiceDrafts'
import type { ModelServiceProviderActions } from './useModelServiceProviderActions'
import { ModelServiceAddProviderDialog } from './ModelServiceAddProviderDialog'
import { ModelServiceModelDrawer } from './ModelServiceModelDrawer'
import { ModelServiceProviderPage } from './ModelServiceProviderPage'

/**
 * 模型服务页与它那三个抽屉的接线（从 `AppShell.tsx` 原样搬出）。
 *
 * 组件自己不留状态：草稿与派生值来自 `useModelServiceDrafts`，写入动作来自
 * `useModelServiceActions` / `useModelServiceProviderActions`。JSX、类名、文案键与顺序一字未改。
 */
export type ModelServiceSectionProps = {
  t: PlatformText
  settings: AppSettings
  noticeText: string | null
  drafts: ModelServiceDrafts
  sync: ModelServiceActions
  provider: ModelServiceProviderActions
  onSelectProvider: (providerId: string) => void
  onOpenExternal: (url?: string) => void
}

export function ModelServiceSection(props: ModelServiceSectionProps): React.ReactElement {
  const { t, settings, noticeText, drafts, sync, provider, onSelectProvider, onOpenExternal } = props
  const {
    providers, filteredProviders, selectedProvider, selectedProviderId, providerSearch, apiKeyDraft,
    providerDraft, modelGroups, collapsedModelGroups, connectionStatusText, isSyncingModels,
    modelSyncError, connectionCheckModels, connectionCheckApiKeyOptions, connectionCheckModelId,
    connectionCheckApiKeyOptionId, isTestingConnection, connectionCheckResult,
    isConnectionCheckOpen, isModelSyncOpen, modelSyncPreview, modelSyncSelection, isAddProviderOpen,
    isAddModelOpen, modelDraft, editingModelId, pinnedModelIds,
    setProviderSearch, setApiKeyDraft, setConnectionCheckModelId, setConnectionCheckApiKeyOptionId,
    setConnectionCheckResult, setIsConnectionCheckOpen, setIsModelSyncOpen, setIsAddProviderOpen,
    setModelDraft
  } = drafts
  const {
    saveApiKeyDraft, previewModelSync, applyModelSyncPreview, toggleModelSyncAdded, toggleModelSyncMissing,
    toggleModelSyncStale, toggleAllModelSyncAdded, toggleAllModelSyncMissing, toggleAllModelSyncStale
  } = sync
  const {
    addProvider, saveProviderEndpoints, saveProviderImageEndpoint, setProviderEnabled,
    enableProviderAndRecheck, handleApiKeyDraftChange, removeProviderById, removeSelectedProvider,
    setProviderEnabledById, enableModelGatewayAndRecheck, openProxySettings, openConnectionCheck,
    startConnectionCheck, saveModel, openAddModelDrawer, openEditModelDrawer, closeModelDrawer,
    removeModel, clearAllProviderModels, toggleModelPinned, toggleModelGroup
  } = provider

  return (
        <ModelServiceProviderPage
          labels={t.models}
          language={settings.language}
          statusText={{ saved: t.status.saved, failed: t.status.failed }}
          providers={providers}
          filteredProviders={filteredProviders}
          selectedProvider={selectedProvider}
          selectedProviderId={selectedProviderId}
          providerSearch={providerSearch}
          enabled={providerDraft.enabled}
          apiKeyDraft={apiKeyDraft}
          modelGroups={modelGroups}
          collapsedGroups={collapsedModelGroups}
          connectionStatus={connectionStatusText}
          isSyncingModels={isSyncingModels}
          notice={noticeText}
          syncError={modelSyncError}
          onProviderSearchChange={setProviderSearch}
          onSelectProvider={onSelectProvider}
          onAddProvider={() => setIsAddProviderOpen(true)}
          onApiKeyDraftChange={handleApiKeyDraftChange}
          onToggleGroup={toggleModelGroup}
          actions={{
            saveApiKeyDraft,
            clearApiKeyDraft: () => setApiKeyDraft(''),
            setProviderEnabled,
            saveEndpoints: saveProviderEndpoints,
            saveImageEndpoint: saveProviderImageEndpoint,
            removeModel,
            clearAllModels: clearAllProviderModels,
            removeProvider: removeSelectedProvider,
            removeProviderById,
            setProviderEnabledById,

            previewModelSync: () => void previewModelSync(),
            openAddModel: openAddModelDrawer,
            openEditModel: openEditModelDrawer,
            openConnectionCheck,
            openExternal: onOpenExternal,
            revealApiKey: (providerId) => window.platform.modelProviders.revealApiKey(providerId)
          }}
          overlays={(
            <>
              <ProviderConnectionCheckDrawer
            providerName={selectedProvider ? resolveProviderDisplayName(t.models, selectedProvider) : ''}
                open={isConnectionCheckOpen}
                models={connectionCheckModels}
                apiKeyOptions={connectionCheckApiKeyOptions}
                selectedModelId={connectionCheckModelId}
                selectedApiKeyOptionId={connectionCheckApiKeyOptionId}
                isSubmitting={isTestingConnection}
                result={connectionCheckResult}
                providerEnabled={providerDraft.enabled}
                hasApiKey={connectionCheckApiKeyOptions.length > 0}
                environment={{
                  proxyMode: settings.network.proxyMode,
                  proxyUrl: settings.network.proxyUrl,
                  targetHost: selectedProvider ? resolveProviderHost(selectedProvider.baseUrl) : ''
                }}
                onEnableProvider={() => void enableProviderAndRecheck()}
                onOpenProxySettings={openProxySettings}
                onEnableModelGateway={() => void enableModelGatewayAndRecheck()}
                labels={{
                  title: t.models.connectionCheckTitle,
                  model: t.models.connectionCheckModel,
                  apiKey: t.models.connectionCheckApiKey,
                  cancel: t.models.cancel,
                  start: t.models.connectionCheckStart,
                  providerStatus: t.models.connectionCheckProviderStatus,
                  statusEnabled: t.models.connectionCheckStatusEnabled,
                  statusDisabled: t.models.connectionCheckStatusDisabled,
                  enableProvider: t.models.connectionCheckEnableProvider,
                  detailPrefix: t.models.connectionCheckDetailPrefix,
                  environment: t.models.connectionCheckEnvironment,
                  proxy: t.models.connectionCheckProxy,
                  proxyDirect: t.models.connectionCheckProxyDirect,
                  proxySystem: t.models.connectionCheckProxySystem,
                  proxyCustom: t.models.connectionCheckProxyCustom,
                  targetHost: t.models.connectionCheckTargetHost,
                  networkDiagnosis: t.models.connectionCheckNetworkDiagnosis,
                  networkDiagnosisNone: t.models.connectionCheckNetworkDiagnosisNone,
                  proxyNote: t.models.connectionCheckProxyNote,
                  networkFailureHint: t.models.connectionCheckNetworkFailureHint,
                  customProxyFailureHint: t.models.connectionCheckCustomProxyFailureHint,
                  openProxySettings: t.models.connectionCheckOpenProxySettings,
                  gatewayDisabledHint: t.models.connectionCheckGatewayDisabledHint,
                  enableModelGateway: t.models.connectionCheckEnableModelGateway,
                  retry: t.models.retry,
                  runtimeLanes: {
                    ordinaryChat: t.models.connectionCheckOrdinaryChat,
                    direct: t.models.connectionCheckDirect,
                    gateway: t.models.connectionCheckGateway,
                    final: t.models.connectionCheckFinal,
                    ready: t.models.connectionCheckAgentReady,
                    notReady: t.models.connectionCheckAgentNotReady,
                    checking: t.models.connectionCheckStart,
                    mixed: t.models.connectionCheckAgentMixed,
                    reasons: t.models,
                    detailPrefix: t.models.connectionCheckDetailPrefix,
                    irrelevantHint: t.models.connectionCheckIrrelevantHint,
                    gatewayDisabledHint: t.models.connectionCheckGatewayDisabledHint
                  },
                  noModels: t.models.noChatModelForConnectionCheck,
                  noApiKeys: t.models.connectionNeedsConfig
                }}
                onClose={() => setIsConnectionCheckOpen(false)}
                onModelChange={(modelId) => {
                  setConnectionCheckModelId(modelId)
                  setConnectionCheckResult(null)
                }}
                onApiKeyOptionChange={(optionId) => {
                  setConnectionCheckApiKeyOptionId(optionId)
                  setConnectionCheckResult(null)
                }}
                onStart={() => void startConnectionCheck()}
              />

              <ProviderModelSyncDrawer
                open={isModelSyncOpen}
                preview={modelSyncPreview}
                selection={modelSyncSelection}
                isApplying={isSyncingModels}
                labels={{
                  title: t.models.modelSyncTitle,
                  added: t.models.modelSyncAdded,
                  missing: t.models.modelSyncMissing,
                  localSurplus: t.models.modelSyncLocalSurplus,
                  localSurplusHint: t.models.modelSyncLocalSurplusHint,
                  upToDate: t.models.modelSyncUpToDate,
                  upToDateHint: t.models.modelSyncUpToDateHint,
                  removedHint: t.models.modelSyncRemovedHint,
                  selectAll: t.models.selectAll,
                  deselectAll: t.models.deselectAll,
                  cancel: t.models.cancel,
                  apply: t.models.modelSyncApply,
                  addSummary: (selected, total) => t.models.modelSyncAddSummary.replace('{selected}', String(selected)).replace('{total}', String(total)),
                  removeSummary: (selected, total) =>
                    t.models.modelSyncRemoveSummary.replace('{selected}', String(selected)).replace('{total}', String(total))
                }}
                onClose={() => setIsModelSyncOpen(false)}
                onApply={() => void applyModelSyncPreview()}
                onToggleAdded={toggleModelSyncAdded}
                onToggleMissing={toggleModelSyncMissing}
                onToggleStale={toggleModelSyncStale}
                onToggleAllAdded={toggleAllModelSyncAdded}
                onToggleAllMissing={toggleAllModelSyncMissing}
                onToggleAllStale={toggleAllModelSyncStale}
              />

              <ModelServiceAddProviderDialog
                open={isAddProviderOpen}
                labels={t.models}
                providers={providers}
                onCancel={() => setIsAddProviderOpen(false)}
                onAdd={addProvider}
              />

              <ModelServiceModelDrawer
                open={isAddModelOpen}
                labels={t.models}
                draft={modelDraft}
                isEditing={editingModelId !== null}
                isSaving={false}
                chatProtocolAvailability={{
                  responses: Boolean(selectedProvider && resolveProviderChatBase(selectedProvider, 'responses')),
                  gemini: Boolean(selectedProvider && resolveProviderChatBase(selectedProvider, 'gemini')),
                  messages: Boolean(selectedProvider && resolveProviderChatBase(selectedProvider, 'messages'))
                }}
                pinned={
                  editingModelId !== null &&
                  selectedProvider !== null &&
                  pinnedModelIds.includes(`${selectedProvider.id}:${editingModelId}`)
                }
                onChange={setModelDraft}
                onTogglePin={() => {
                  if (editingModelId !== null && selectedProvider !== null) {
                    toggleModelPinned(`${selectedProvider.id}:${editingModelId}`)
                  }
                }}
                onSave={() => void saveModel()}
                onClose={closeModelDrawer}
              />
            </>
          )}
        />

  )
}
