import { useEffect, useMemo, useRef, useState } from 'react'

import { isProviderDraftConnectionTestable } from '@platform/ai/providers/providerConfigDraft'
import type { ModelSyncPreview } from '@platform/ai/providers/providerModelSync'
import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import type { PlatformText } from '../../i18n/platformText'
import { resolveLiveText, type PlatformLiveText } from '../liveText'
import { useLiveNotice } from '../useLiveNotice'
import { clearModelSyncSelection, type ProviderModelSyncSelection } from './modelSyncPlan'
import { createConnectionCheckApiKeyOptions } from '../modelProviderConnectionCheck'
import { groupModelsForDisplay } from '../modelProviderDisplay'
import { createModelServiceSettingsDraftOwner, type SettingsDraftOwner } from '../settings/SettingsWorkspaceAdapter'
import { PINNED_MODEL_IDS_STORAGE_KEY, parsePinnedModelIds } from '../modelPins'
import { createEmptyModelDraft, type ModelDraft } from '../modelDrafts'
import type { ProviderConnectionCheckResult } from '../ProviderConnectionCheckDrawer'
import type { ModelSyncErrorState } from '../modelServiceSyncError'
import { resolveProviderDisplayName } from './providerDisplayName'

/**
 * 模型服务屏的草稿与派生值（从 `AppShell.tsx` 原样搬出，只搬运、不改行为）。
 *
 * 这一屏自己拥有的东西：供应商/模型草稿、连接检查的选择、同步预览状态，以及由它们算出的派生值。
 * 写入 IPC 的动作在 `useModelServiceActions`，渲染在 `ModelServiceSection`。
 * 外壳仍拥有：`providers` 列表与重读、当前语言文案 `t`、以及设置本体——它们不属于这一屏。
 */
export type ProviderDraft = {
  enabled: boolean
}

export function createEmptyProviderDraft(): ProviderDraft {
  return {
    enabled: true
  }
}

export type ModelServiceDraftsParams = {
  providers: readonly SafeModelProvider[]
  selectedProviderId: string | null
  t: PlatformText
}

export function useModelServiceDrafts(params: ModelServiceDraftsParams) {
  const { providers, selectedProviderId, t } = params

  const [providerDraft, setProviderDraft] = useState<ProviderDraft>(createEmptyProviderDraft)
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [modelDraft, setModelDraft] = useState<ModelDraft>(createEmptyModelDraft)
  const [isAddModelOpen, setIsAddModelOpen] = useState(false)
  const [editingModelId, setEditingModelId] = useState<string | null>(null)
  const [providerSearch, setProviderSearch] = useState('')
  const liveNotice = useLiveNotice()
  const [connectionStatus, setConnectionStatus] = useState<PlatformLiveText | null>(null)
  const [isTestingConnection, setIsTestingConnection] = useState(false)
  const [preserveProviderDraftForId, setPreserveProviderDraftForId] = useState<string | null>(null)
  const [isConnectionCheckOpen, setIsConnectionCheckOpen] = useState(false)
  const [connectionCheckModelId, setConnectionCheckModelId] = useState('')
  const [connectionCheckApiKeyOptionId, setConnectionCheckApiKeyOptionId] = useState('')
  const [connectionCheckResult, setConnectionCheckResult] = useState<ProviderConnectionCheckResult | null>(null)
  const [isModelSyncOpen, setIsModelSyncOpen] = useState(false)
  const [isSyncingModels, setIsSyncingModels] = useState(false)
  const [isAddProviderOpen, setIsAddProviderOpen] = useState(false)
  const [modelSyncPreview, setModelSyncPreview] = useState<ModelSyncPreview | null>(null)
  const [modelSyncError, setModelSyncError] = useState<ModelSyncErrorState | null>(null)
  const [modelSyncSelection, setModelSyncSelection] = useState<ProviderModelSyncSelection>(clearModelSyncSelection)
  const [collapsedModelGroups, setCollapsedModelGroups] = useState<Set<string>>(() => new Set())
  const [pinnedModelIds, setPinnedModelIds] = useState<string[]>(() =>
    parsePinnedModelIds(window.localStorage.getItem(PINNED_MODEL_IDS_STORAGE_KEY))
  )
  const autoSyncedProviderSignaturesRef = useRef<Set<string>>(new Set())
  const previousSelectedProviderIdRef = useRef<string | null>(null)
  const connectionStatusText = resolveLiveText(connectionStatus, t)
  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId) ?? null,
    [providers, selectedProviderId]
  )
  const providerConnectionTestable = selectedProvider
    ? isProviderDraftConnectionTestable(selectedProvider, { enabled: providerDraft.enabled, apiKey: apiKeyDraft })
    : false
  // PLAT-63 C：归档模型（presetStale）不参与计数 / 列表 / 探测候选，但数据仍保留。
  const connectionCheckModels = useMemo(
    () => selectedProvider?.models.filter((model) => model.presetStale !== true && model.capabilities.chat) ?? [],
    [selectedProvider]
  )
  const connectionCheckApiKeyOptions = useMemo(
    () => (selectedProvider ? createConnectionCheckApiKeyOptions(selectedProvider, apiKeyDraft) : []),
    [apiKeyDraft, selectedProvider]
  )
  const modelGroups = useMemo(
    () => (selectedProvider
      ? groupModelsForDisplay(
          selectedProvider.models.filter((model) => model.presetStale !== true),
          t.models.ungroupedModels,
          pinnedModelIds,
          selectedProvider.id
        )
      : []),
    [pinnedModelIds, selectedProvider, t.models.ungroupedModels]
  )
  const filteredProviders = useMemo(() => {
    const keyword = providerSearch.trim().toLowerCase()
    if (!keyword) return providers

    return providers.filter((provider) => {
      const searchText = `${resolveProviderDisplayName(t.models, provider)} ${provider.name} ${provider.id}`.toLowerCase()
      return searchText.includes(keyword)
    })
  }, [providerSearch, providers, t.models])
  const settingsDraftOwner = useMemo<SettingsDraftOwner>(() => createModelServiceSettingsDraftOwner({
    readDraft: () => ({ provider: selectedProvider, enabled: providerDraft.enabled, apiKey: apiKeyDraft }),
    clearApiKeyDraft: () => setApiKeyDraft(''),
    save: (provider) => window.platform.modelProviders.upsert(provider)
  }), [apiKeyDraft, providerDraft.enabled, selectedProvider])

  useEffect(() => {
    const currentProviderId = selectedProvider?.id ?? null
    const providerChanged = previousSelectedProviderIdRef.current !== currentProviderId
    previousSelectedProviderIdRef.current = currentProviderId

    if (!selectedProvider) {
      setProviderDraft(createEmptyProviderDraft())
      if (providerChanged) {
        setApiKeyDraft('')
        setConnectionStatus(null)
        setConnectionCheckResult(null)
        setIsConnectionCheckOpen(false)
        setConnectionCheckModelId('')
        setConnectionCheckApiKeyOptionId('')
        setIsModelSyncOpen(false)
        setModelSyncPreview(null)
        setModelSyncError(null)
        setModelSyncSelection(clearModelSyncSelection())
        setIsSyncingModels(false)
      }
      return
    }

    setProviderDraft({
      enabled: selectedProvider.enabled
    })
    if (preserveProviderDraftForId === selectedProvider.id) {
      setPreserveProviderDraftForId(null)
    } else if (providerChanged) {
      setApiKeyDraft('')
      setConnectionStatus(null)
      setConnectionCheckResult(null)
      setIsTestingConnection(false)
      setIsConnectionCheckOpen(false)
      setConnectionCheckModelId('')
      setConnectionCheckApiKeyOptionId('')
      setIsModelSyncOpen(false)
      setModelSyncPreview(null)
      setModelSyncError(null)
      setModelSyncSelection(clearModelSyncSelection())
      setIsSyncingModels(false)
    }

    if (providerChanged) {
      setModelDraft(createEmptyModelDraft())
      setIsAddModelOpen(false)
      setEditingModelId(null)
      setCollapsedModelGroups(new Set())
    }
  }, [preserveProviderDraftForId, selectedProvider])


  return {
    providerDraft, setProviderDraft,
    apiKeyDraft, setApiKeyDraft,
    modelDraft, setModelDraft,
    isAddModelOpen, setIsAddModelOpen,
    editingModelId, setEditingModelId,
    providerSearch, setProviderSearch,
    connectionStatus, setConnectionStatus,
    isTestingConnection, setIsTestingConnection,
    preserveProviderDraftForId, setPreserveProviderDraftForId,
    isConnectionCheckOpen, setIsConnectionCheckOpen,
    connectionCheckModelId, setConnectionCheckModelId,
    connectionCheckApiKeyOptionId, setConnectionCheckApiKeyOptionId,
    connectionCheckResult, setConnectionCheckResult,
    isModelSyncOpen, setIsModelSyncOpen,
    isSyncingModels, setIsSyncingModels,
    isAddProviderOpen, setIsAddProviderOpen,
    modelSyncPreview, setModelSyncPreview,
    modelSyncError, setModelSyncError,
    modelSyncSelection, setModelSyncSelection,
    collapsedModelGroups, setCollapsedModelGroups,
    pinnedModelIds, setPinnedModelIds,
    autoSyncedProviderSignaturesRef,
    previousSelectedProviderIdRef,
    connectionStatusText,
    liveNotice,
    providers,
    selectedProviderId,
    selectedProvider,
    providerConnectionTestable,
    connectionCheckModels,
    connectionCheckApiKeyOptions,
    modelGroups,
    filteredProviders,
    settingsDraftOwner
  }
}

export type ModelServiceDrafts = ReturnType<typeof useModelServiceDrafts>
