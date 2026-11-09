import type { AddProviderInput } from './ModelServiceAddProviderDialog'
import type { ModelDefinition, ModelProviderInput, ProviderChatEndpoint, ProviderImageEndpoints } from '@platform/ai/providers/modelProviderTypes'
import { buildProviderInputFromDraft } from '@platform/ai/providers/providerConfigDraft'
import { isProviderModelSyncFailure } from '@platform/ai/providers/providerModelSync'

import type { PlatformText } from '../../i18n/platformText'
import { buildModelDefinitionFromDraft, createEmptyModelDraft, createModelDraftFromModel } from '../modelDrafts'
import { createConnectionCheckApiKeyOptions, selectDefaultConnectionCheckModelId } from '../modelProviderConnectionCheck'
import { describeConnectionStatus } from '../modelConnectionStatus'
import { sanitizeIpcErrorMessage } from '../modelServiceSyncError'
import { togglePinnedModelId } from '../modelPins'
import { resolveProviderRuntimeCheckReasonCode } from '../providerRuntimeCheckReason'
import type { ModelServiceDrafts } from './useModelServiceDrafts'

/**
 * 模型服务的**供应商/模型动作**（从 `AppShell.tsx` 原样搬出）：供应商增删改、端点与图像端点保存、
 * 连接检查（含抽屉里的就地启用）、模型增删、置顶与分组折叠。
 *
 * 状态与派生值全部来自 `useModelServiceDrafts`；Key 草稿的落库动作来自 `useModelServiceActions`
 * （两处共用同一个 `persistSelectedProviderDraft`，不复制一份实现）。
 */
export type ModelServiceProviderActionsParams = {
  drafts: ModelServiceDrafts
  persistSelectedProviderDraft: (enabledOverride?: boolean) => Promise<void>
  reloadProviders: (providerId?: string) => Promise<void>
  providers: readonly import('@platform/ai/providers/modelProviderTypes').SafeModelProvider[]
  selectProvider: (providerId: string) => void
  setActiveNavKey: (navKey: string) => void
  setSettingsPanelKey: (panelKey: string) => void
  t: PlatformText
}

export function useModelServiceProviderActions(params: ModelServiceProviderActionsParams) {
  const {
    drafts, persistSelectedProviderDraft, reloadProviders, providers, selectProvider,
    setActiveNavKey, setSettingsPanelKey, t
  } = params
  const {
    selectedProvider, selectedProviderId, apiKeyDraft, providerDraft, modelDraft, editingModelId,
    providerConnectionTestable, connectionCheckModelId, connectionCheckApiKeyOptionId, liveNotice,
    pinnedModelIds, connectionCheckModels, connectionCheckApiKeyOptions,
    setProviderDraft, setApiKeyDraft, setModelDraft, setIsAddModelOpen, setEditingModelId,
    setConnectionStatus, setIsTestingConnection, setPreserveProviderDraftForId,
    setConnectionCheckModelId, setConnectionCheckApiKeyOptionId, setConnectionCheckResult,
    setIsConnectionCheckOpen, setIsAddProviderOpen, setPinnedModelIds, setCollapsedModelGroups
  } = drafts

  async function addProvider(input: AddProviderInput): Promise<void> {
    const id = `provider-${Date.now()}`
    const provider: ModelProviderInput = {
      id,
      name: input.name,
      // 自建供应商没有预设 ⇒ 端点清单由用户填的两个地址组成（Chat 在前 = 默认端点）。
      endpoints: input.endpoints,
      enabled: true,
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
      models: []
    }
    await window.platform.modelProviders.upsert(provider)
    await reloadProviders(id)
    setIsAddProviderOpen(false)
  }

  /**
   * PLAT-61：改动即存 —— 密钥草稿由「焦点离开密钥行」触发。
   * 仍走既有 Settings 草稿 owner（同一个 buildProviderInputFromDraft + 同一个 upsert 回调），
   * 不新增 IPC。失败向上抛：由页面回滚草稿并给行内错误（不回退整页）。
   */
  async function saveProviderEndpoints(endpoints: readonly ProviderChatEndpoint[]): Promise<void> {
    if (!selectedProvider) return
    await window.platform.modelProviders.upsert({
      ...buildProviderInputFromDraft(selectedProvider, { enabled: providerDraft.enabled, apiKey: apiKeyDraft }),
      endpoints: [...endpoints]
    })
    await reloadProviders(selectedProvider.id)
  }

  /** 图像端点（生成 / 编辑）保存：不是聊天协议，单独一份字段。 */
  async function saveProviderImageEndpoint(
    kind: 'generation' | 'edit',
    value: string | undefined
  ): Promise<void> {
    if (!selectedProvider) return
    const next: ProviderImageEndpoints = { ...selectedProvider.imageEndpoints }
    const trimmed = value?.trim() ?? ''
    if (trimmed) next[kind] = trimmed
    else delete next[kind]
    await window.platform.modelProviders.upsert({
      ...buildProviderInputFromDraft(selectedProvider, { enabled: providerDraft.enabled, apiKey: apiKeyDraft }),
      ...(Object.keys(next).length > 0 ? { imageEndpoints: next } : { imageEndpoints: undefined })
    })
    await reloadProviders(selectedProvider.id)
  }

  /** PLAT-61：右上角唯一启用开关（点一下立即保存）；失败回滚由页面负责。 */
  async function setProviderEnabled(enabled: boolean): Promise<void> {
    if (!selectedProvider) return
    await window.platform.modelProviders.setEnabled(selectedProvider.id, enabled)
    await reloadProviders(selectedProvider.id)
  }

  /**
   * PLAT-61 诊断可用性：抽屉顶部「启用」→ 走既有 setEnabled 保存路径 → 就地重跑一次检查。
   * 失败只更新行内状态，不关闭抽屉。
   */
  async function enableProviderAndRecheck(): Promise<void> {
    if (!selectedProvider) return
    try {
      await window.platform.modelProviders.setEnabled(selectedProvider.id, true)
      await reloadProviders(selectedProvider.id)
      setProviderDraft((current) => ({ ...current, enabled: true }))
    } catch (error) {
      setConnectionStatus(() => (current: PlatformText) => sanitizeIpcErrorMessage(error) ?? current.status.failed)
      return
    }
    await startConnectionCheck({ enabledOverride: true })
  }

  function handleApiKeyDraftChange(nextValue: string): void {
    setApiKeyDraft(nextValue)
    setConnectionStatus(null)
    setConnectionCheckResult(null)
  }

  async function removeProviderById(providerId: string): Promise<void> {
    const target = providers.find((provider) => provider.id === providerId)
    if (!target || target.isSystem) return
    const index = providers.findIndex((provider) => provider.id === providerId)
    const adjacent = providers[index + 1] ?? providers[index - 1]
    await window.platform.modelProviders.remove(providerId)
    await reloadProviders(adjacent?.id)
  }

  async function removeSelectedProvider(): Promise<void> {
    if (selectedProvider) await removeProviderById(selectedProvider.id)
  }

  async function setProviderEnabledById(providerId: string, enabled: boolean): Promise<void> {
    await window.platform.modelProviders.setEnabled(providerId, enabled)
    await reloadProviders(providerId)
  }

  async function enableModelGatewayAndRecheck(): Promise<void> {
    try {
      await window.platform.agents.setModelGatewayEnabled(true)
    } catch (error) {
      setConnectionStatus(() => (current: PlatformText) => sanitizeIpcErrorMessage(error) ?? current.status.failed)
      return
    }
    await startConnectionCheck()
  }

  /** PLAT-61：抽屉里的「去设置代理」只跳转到「基础设置」的代理段，不就地改设置。 */
  function openProxySettings(): void {
    setIsConnectionCheckOpen(false)
    setActiveNavKey('settings')
    setSettingsPanelKey('preferences')
  }

  function openConnectionCheck(): void {
    if (!selectedProvider) return
    if (!providerConnectionTestable) {
      setConnectionStatus(() => (current: PlatformText) => current.models.connectionNeedsConfig)
      return
    }

    const defaultModelId = selectDefaultConnectionCheckModelId(selectedProvider)
    if (!defaultModelId) {
      setConnectionStatus(() => (current: PlatformText) => current.models.noChatModelForConnectionCheck)
      return
    }

    const apiKeyOptions = createConnectionCheckApiKeyOptions(selectedProvider, apiKeyDraft)
    if (apiKeyOptions.length === 0) {
      setConnectionStatus(() => (current: PlatformText) => current.models.connectionNeedsConfig)
      return
    }

    setConnectionCheckModelId(defaultModelId)
    setConnectionCheckApiKeyOptionId(apiKeyOptions[0].id)
    setConnectionCheckResult(null)
    setConnectionStatus(null)
    setIsConnectionCheckOpen(true)
  }

  async function startConnectionCheck(options: { enabledOverride?: boolean } = {}): Promise<void> {
    if (!selectedProvider) return
    const selectedModel = connectionCheckModels.find((model) => model.id === connectionCheckModelId) ?? connectionCheckModels[0]
    const selectedApiKeyOption =
      connectionCheckApiKeyOptions.find((option) => option.id === connectionCheckApiKeyOptionId) ?? connectionCheckApiKeyOptions[0]

    if (!selectedModel) {
      setConnectionCheckResult({ ok: false, message: t.models.noChatModelForConnectionCheck })
      return
    }

    if (!selectedApiKeyOption) {
      setConnectionCheckResult({ ok: false, message: t.models.connectionNeedsConfig })
      return
    }

    setIsTestingConnection(true)
    setConnectionStatus(null)
    setConnectionCheckResult(null)
    try {
      setPreserveProviderDraftForId(selectedProvider.id)
      await persistSelectedProviderDraft(options.enabledOverride)
      await reloadProviders(selectedProvider.id)
      const report = (await window.platform.modelProviders.runRuntimeChecks(selectedProvider.id, {
        modelId: selectedModel.id,
        apiKey: selectedApiKeyOption.apiKey,
        runtimeId: 'claude-code',
        checkGateway: true
      })) as import('@platform/ai/agent-platform/runtime/compatibility/providerRuntimeCheckTypes').ProviderRuntimeCheckReport
      const overallOk = report.finalCompatibility.selectable
      // PLAT-61：最终结论文案同样「把原因说出来」（例如供应商停用），不再只回英文 summary。
      const reasonCode = resolveProviderRuntimeCheckReasonCode({
        status: report.finalCompatibility.status,
        summary: report.finalCompatibility.summary,
        providerEnabled: options.enabledOverride === true || providerDraft.enabled,
        hasApiKey: connectionCheckApiKeyOptions.length > 0
      })
      const chatOk = report.ordinaryChat.status === 'ready'
      const messageFor = describeConnectionStatus({ overallOk, chatOk, reasonCode, summary: report.finalCompatibility.summary })
      setConnectionCheckResult({ ok: overallOk, message: messageFor(t), report })
      setConnectionStatus(chatOk && overallOk ? null : () => messageFor)
    } catch (error) {
      setConnectionCheckResult({ ok: false, message: sanitizeIpcErrorMessage(error) ?? t.status.failed })
      setConnectionStatus(() => (current: PlatformText) => sanitizeIpcErrorMessage(error) ?? current.status.failed)
    } finally {
      setIsTestingConnection(false)
    }
  }

  async function saveModel(): Promise<void> {
    if (!selectedProvider) return

    const model = buildModelDefinitionFromDraft(modelDraft)
    model.capabilities.capabilitiesEdited = true

    await window.platform.modelProviders.addOrUpdateModel(selectedProvider.id, model)
    setModelDraft(createEmptyModelDraft())
    setIsAddModelOpen(false)
    setEditingModelId(null)
    await reloadProviders(selectedProvider.id)
  }

  function openAddModelDrawer(): void {
    setEditingModelId(null)
    setModelDraft(createEmptyModelDraft())
    setIsAddModelOpen(true)
  }

  function openEditModelDrawer(model: ModelDefinition): void {
    setEditingModelId(model.id)
    setModelDraft(createModelDraftFromModel(model))
    setIsAddModelOpen(true)
  }

  function closeModelDrawer(): void {
    setIsAddModelOpen(false)
    setEditingModelId(null)
    setModelDraft(createEmptyModelDraft())
  }

  async function removeModel(modelId: string): Promise<void> {
    if (!selectedProvider) return
    await window.platform.modelProviders.removeModel(selectedProvider.id, modelId)
    await reloadProviders(selectedProvider.id)
    liveNotice.show((current) => current.models.modelRemovedNotice(1))
  }

  /**
   * PLAT-72：一键清空该供应商的全部模型。
   * 复用 `applyModelSync` 的 `toRemove`（不新增 IPC）：主进程按**一次** store mutation 落库，
   * 预设来源的模型由既有逻辑写墓碑 ⇒ 下次合并不会复活；失败整体不写入。
   */
  async function clearAllProviderModels(): Promise<void> {
    if (!selectedProvider) return
    const modelIds = selectedProvider.models.map((model) => model.id)
    if (modelIds.length === 0) return
    const outcome = await window.platform.modelProviders.applyModelSync(selectedProvider.id, {
      toAdd: [],
      toUpdate: [],
      toRemove: modelIds
    })
    if (isProviderModelSyncFailure(outcome)) throw new Error(outcome.reasonCode)
    await reloadProviders(selectedProvider.id)
  }

  function toggleModelPinned(modelId: string): void {
    setPinnedModelIds((current) => togglePinnedModelId(current, modelId))
  }

  function toggleModelGroup(groupName: string): void {
    setCollapsedModelGroups((current) => {
      const next = new Set(current)
      if (next.has(groupName)) next.delete(groupName)
      else next.add(groupName)
      return next
    })
  }

  /**
   * 主窗的 antd 主题：**唯一来源**与分离窗共用（PLAT-39 ②：分离窗此前没有 ConfigProvider ⇒ 同一组件
   * 在分离窗退化成 antd 默认浅色 token）。PLAT-42：token 值已上移到 `platform/ui/theme` 单源
   * （`buildWindowAntdTheme`），本函数只负责把**当前外观**解析成单源需要的两个参数。
   */
  return {
    addProvider,
    saveProviderEndpoints,
    saveProviderImageEndpoint,
    setProviderEnabled,
    enableProviderAndRecheck,
    handleApiKeyDraftChange,
    removeProviderById,
    removeSelectedProvider,
    setProviderEnabledById,
    enableModelGatewayAndRecheck,
    openProxySettings,
    openConnectionCheck,
    startConnectionCheck,
    saveModel,
    openAddModelDrawer,
    openEditModelDrawer,
    closeModelDrawer,
    removeModel,
    clearAllProviderModels,
    toggleModelPinned,
    toggleModelGroup
  }
}

export type ModelServiceProviderActions = ReturnType<typeof useModelServiceProviderActions>
