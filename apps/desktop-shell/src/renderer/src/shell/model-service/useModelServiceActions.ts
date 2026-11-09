import { useEffect } from 'react'

import { buildProviderInputFromDraft } from '@platform/ai/providers/providerConfigDraft'
import { isProviderModelSyncFailure, type ModelSyncPreview, type ModelSyncPreviewOutcome } from '@platform/ai/providers/providerModelSync'

import type { PlatformText } from '../../i18n/platformText'
import {
  buildModelSyncPlan,
  clearModelSyncSelection,
  createModelSyncSelection,
  toggleAllModelSyncSelection,
  toggleModelSyncSelection
} from './modelSyncPlan'
import { sanitizeIpcErrorMessage } from '../modelServiceSyncError'
import type { ModelServiceDrafts } from './useModelServiceDrafts'

/**
 * 模型服务的**写入动作**（从 `AppShell.tsx` 原样搬出）：模型清单同步、Key 草稿保存、
 * 同步预览的应用与勾选。状态全部来自 `useModelServiceDrafts`，这里不新增任何 state。
 */
export type ModelServiceActionsParams = {
  drafts: ModelServiceDrafts
  reloadProviders: (providerId?: string) => Promise<void>
}

export function useModelServiceActions(params: ModelServiceActionsParams) {
  const { drafts, reloadProviders } = params
  const {
    selectedProvider, settingsDraftOwner, apiKeyDraft, providerDraft, setApiKeyDraft, setConnectionStatus,
    liveNotice, modelSyncPreview, modelSyncSelection, setModelSyncError, setIsSyncingModels, setIsModelSyncOpen,
    setModelSyncPreview, setModelSyncSelection, autoSyncedProviderSignaturesRef,
    setPreserveProviderDraftForId, setConnectionCheckResult, setIsConnectionCheckOpen, setIsTestingConnection,
    setConnectionCheckModelId, setConnectionCheckApiKeyOptionId
  } = drafts

  async function saveApiKeyDraft(): Promise<void> {
    if (!selectedProvider) return
    await persistSelectedProviderDraft()
    await reloadProviders(selectedProvider.id)
    // 保存成功后清掉输入草稿 ⇒ 控件回到「已保存掩码」，不会把明文 Key 留在界面上。
    setApiKeyDraft('')
    setConnectionStatus(null)
  }

  async function persistSelectedProviderDraft(enabledOverride?: boolean): Promise<void> {
    // P2-02：保存路径收敛到既有 Settings 草稿 owner（同一个 buildProviderInputFromDraft + 同一个
    // upsert 回调），行为与此前逐字一致；owner 让 Tab 关闭/分离时能读到这份已有表单草稿。
    if (enabledOverride === undefined) {
      await settingsDraftOwner.save()
      return
    }
    // PLAT-61：抽屉里「就地启用后自动重跑」需要在同一个渲染周期内带着新 enabled 落盘，
    // 否则刚启用就会被旧闭包里的 providerDraft.enabled=false 又写回去。
    if (!selectedProvider) return
    await window.platform.modelProviders.upsert(
      buildProviderInputFromDraft(selectedProvider, { enabled: enabledOverride, apiKey: apiKeyDraft })
    )
  }

  /**
   * T4/T5：端点清单保存（编辑器里改地址 / 添加 / 删除 / 设为默认都走它）。
   *
   * 传进来的是**整份有序清单**（`[0]` = 默认端点），所以不存在"只改了一个字段、
   * 其余字段被抹掉"的合并问题；`baseUrl` 由端点清单派生，不需要单独回写。
   */
  useEffect(() => {
    if (!selectedProvider || !selectedProvider.enabled || !selectedProvider.hasApiKey || selectedProvider.models.length > 0) return
    const signature = `${selectedProvider.id}:${selectedProvider.apiKeyPreview}:${selectedProvider.baseUrl}`
    if (autoSyncedProviderSignaturesRef.current.has(signature)) return
    autoSyncedProviderSignaturesRef.current.add(signature)
    void previewModelSync({ autoApplyWhenOnlyAdded: true, openDrawerWhenDiff: false })
  }, [selectedProvider])
  function resetModelSyncState(): void {
    setIsModelSyncOpen(false)
    setModelSyncPreview(null)
    setModelSyncError(null)
    setModelSyncSelection(clearModelSyncSelection())
    setIsSyncingModels(false)
  }

  async function previewModelSync(options: { autoApplyWhenOnlyAdded?: boolean; openDrawerWhenDiff?: boolean } = {}): Promise<void> {
    if (!selectedProvider) return
    // PLAT-61：拉取模型清单是只读操作 ⇒ 只要求 baseUrl + Key，停用状态也允许（便于先看免费模型）。
    if (!selectedProvider.baseUrl.trim() || !(selectedProvider.hasApiKey || apiKeyDraft.trim())) {
      setConnectionStatus(() => (current: PlatformText) => current.models.modelSyncNeedsApiKey)
      return
    }

    setIsSyncingModels(true)
    liveNotice.clear()
    setModelSyncError(null)
    try {
      setPreserveProviderDraftForId(selectedProvider.id)
      await persistSelectedProviderDraft()
      const outcome = (await window.platform.modelProviders.previewModelSync(selectedProvider.id)) as
        | ModelSyncPreview
        | ModelSyncPreviewOutcome
      // PLAT-61：主进程把失败改成结构化结果；原始 IPC Error 不再进入 UI。
      if (isProviderModelSyncFailure(outcome)) {
        setModelSyncError({
          reasonCode: outcome.reasonCode,
          message: outcome.message,
          ...(outcome.upstreamMessage ? { upstreamMessage: outcome.upstreamMessage } : {})
        })
        return
      }
      const preview: ModelSyncPreview = 'ok' in outcome
        ? { added: outcome.added, updated: outcome.updated ?? [], missing: outcome.missing, stale: outcome.stale ?? [] }
        : { ...outcome, stale: outcome.stale ?? [] }
      setModelSyncPreview(preview)
      // 三组默认全选（含「本地多余」）；应用时只有勾选的 id 会真正删除。
      setModelSyncSelection(createModelSyncSelection(preview))

      const hasDiff =
        preview.added.length > 0 ||
        preview.updated.length > 0 ||
        preview.missing.length > 0 ||
        preview.stale.length > 0
      // 静默自动应用只在「纯新增/更新」时发生：任何删除（含本地多余）都必须由用户确认。
      const shouldAutoApply =
        options.autoApplyWhenOnlyAdded &&
        preview.missing.length === 0 &&
        preview.stale.length === 0 &&
        (preview.added.length > 0 || preview.updated.length > 0)
      if (shouldAutoApply) {
        await applyModelSyncPreview(preview, {
          addedIds: new Set(preview.added.map((model) => model.id)),
          missingIds: new Set(),
          staleIds: new Set()
        })
        return
      }

      if (hasDiff || options.openDrawerWhenDiff !== false) {
        setIsModelSyncOpen(true)
      } else {
        liveNotice.show((current) => current.models.modelSyncUpToDate)
      }
    } catch (error) {
      const friendly = sanitizeIpcErrorMessage(error)
      console.warn('[model-providers] preview model sync failed', friendly ?? 'unknown error')
      setModelSyncError({ reasonCode: 'unknown', message: friendly ?? '' })
      if (options.autoApplyWhenOnlyAdded) {
        autoSyncedProviderSignaturesRef.current.delete(`${selectedProvider.id}:${selectedProvider.apiKeyPreview}:${selectedProvider.baseUrl}`)
      }
    } finally {
      setIsSyncingModels(false)
    }
  }

  async function applyModelSyncPreview(
    preview = modelSyncPreview,
    selection = modelSyncSelection,
    options: { closeDrawer?: boolean } = {}
  ): Promise<void> {
    if (!selectedProvider || !preview) return

    setIsSyncingModels(true)
    setModelSyncError(null)
    try {
      const plan = buildModelSyncPlan(preview, selection)
      const outcome = await window.platform.modelProviders.applyModelSync(selectedProvider.id, plan)
      if (isProviderModelSyncFailure(outcome)) {
        setModelSyncError({
          reasonCode: outcome.reasonCode,
          message: outcome.message,
          ...(outcome.upstreamMessage ? { upstreamMessage: outcome.upstreamMessage } : {})
        })
        return
      }
      await reloadProviders(selectedProvider.id)
      const removed = plan.toRemove.length
      liveNotice.show((current) => current.models.modelSyncAppliedSummary(preview.added.length, preview.updated.length, removed))
      if (options.closeDrawer !== false) setIsModelSyncOpen(false)
    } catch (error) {
      const friendly = sanitizeIpcErrorMessage(error)
      console.warn('[model-providers] apply model sync failed', friendly ?? 'unknown error')
      setModelSyncError({ reasonCode: 'unknown', message: friendly ?? '' })
    } finally {
      setIsSyncingModels(false)
    }
  }

  function toggleModelSyncAdded(modelId: string): void {
    setModelSyncSelection((current) => toggleModelSyncSelection(current, 'added', modelId))
  }

  function toggleModelSyncMissing(modelId: string): void {
    setModelSyncSelection((current) => toggleModelSyncSelection(current, 'missing', modelId))
  }

  /** PLAT-63 C：本地多余（预设已变更）——默认勾选，取消即保留。 */
  function toggleModelSyncStale(modelId: string): void {
    setModelSyncSelection((current) => toggleModelSyncSelection(current, 'stale', modelId))
  }

  function toggleAllModelSyncAdded(): void {
    if (!modelSyncPreview) return
    setModelSyncSelection((current) => toggleAllModelSyncSelection(current, 'added', modelSyncPreview))
  }

  function toggleAllModelSyncMissing(): void {
    if (!modelSyncPreview) return
    setModelSyncSelection((current) => toggleAllModelSyncSelection(current, 'missing', modelSyncPreview))
  }

  function toggleAllModelSyncStale(): void {
    if (!modelSyncPreview) return
    setModelSyncSelection((current) => toggleAllModelSyncSelection(current, 'stale', modelSyncPreview))
  }

  return {
    saveApiKeyDraft,
    persistSelectedProviderDraft,
    resetModelSyncState,
    previewModelSync,
    applyModelSyncPreview,
    toggleModelSyncAdded,
    toggleModelSyncMissing,
    toggleModelSyncStale,
    toggleAllModelSyncAdded,
    toggleAllModelSyncMissing,
    toggleAllModelSyncStale
  }
}

export type ModelServiceActions = ReturnType<typeof useModelServiceActions>
