import { type ReactNode, useEffect, useState } from 'react'
import { message, Modal } from 'antd'

import type { ModelDefinition, ProviderChatEndpoint, SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { needsModelProtocolNotice, providerReachabilityOf, resolveProviderKeyUrl } from '@platform/ai/providers/providerPresets'
import { configuredModelChatProtocols } from '@platform/ai/providers/providerChatEndpoints'
import type { AppLanguage } from '@platform/settings/schema/appSettings'

import type { PlatformText } from '../../i18n/platformText'
import {
  formatModelSyncFailureText,
  resolveModelSyncFailureDetail,
  type ModelSyncErrorState
} from '../modelServiceSyncError'
import type { ModelGroup } from '../modelGrouping'
import type { RevealModelProviderApiKey } from '../settings/model-service/ModelProviderApiKeyField'
import { ModelServiceBrandBlock } from './ModelServiceBrandBlock'
import {
  ModelServiceProtocolNotice,
  protocolNoticeStorageKey,
  readProtocolNoticeDismissed,
  writeProtocolNoticeDismissed
} from './ModelServiceProtocolNotice'
import { ModelServiceApiAddressSection } from './ModelServiceApiAddressSection'
import { ModelServiceKeySection } from './ModelServiceKeySection'
import { ModelServiceModelsSection } from './ModelServiceModelsSection'
import { ModelServiceProviderRail } from './ModelServiceProviderRail'
import { resolveProviderDisplayName } from './providerDisplayName'
import { ModelServiceRequestConfigDrawer } from './ModelServiceRequestConfigDrawer'
import { useAutoModelDetection } from './useAutoModelDetection'
import { useModelServiceAutosave } from './useModelServiceAutosave'

/**
 * PLAT-61：模型服务 → 供应商配置。
 *
 * 结构：左栏供应商列表 + 右栏无卡片边框的详情（标题行 / 品牌块 / 密钥 / 两个端点 / 模型）。
 * 保存模型：**没有保存按钮**，输入框失焦保存、开关与下拉与增删立即保存；
 * 保存中只锁当前控件，成功在标题旁显示 2s「已保存」，失败回滚该控件并给行内错误。
 * 本组件只持有 UI 保存状态；所有写入仍走 AppShell 注入的既有 IPC 包装（不新增通道）。
 */
export type ModelServiceProviderPageActions = {
  saveApiKeyDraft: () => Promise<void>
  clearApiKeyDraft: () => void
  setProviderEnabled: (enabled: boolean) => Promise<void>
  /** T4/T5：整份端点清单（顺序即优先级，`[0]` = 默认端点）。 */
  saveEndpoints: (endpoints: readonly ProviderChatEndpoint[]) => Promise<void>
  /** 图像端点（生成 / 编辑）保存。 */
  saveImageEndpoint: (kind: 'generation' | 'edit', value: string | undefined) => Promise<void>
  removeModel: (modelId: string) => Promise<void>
  removeProvider: () => Promise<void>
  removeProviderById: (providerId: string) => Promise<void>
  setProviderEnabledById: (providerId: string, enabled: boolean) => Promise<void>

  previewModelSync: () => void
  /** PLAT-72：清空该供应商全部模型（复用 applyModelSync 的 toRemove，不新增通道）。 */
  clearAllModels: () => Promise<void>
  openAddModel: () => void
  openEditModel: (model: ModelDefinition) => void
  /** PLAT-61：打开连接检查抽屉（行内「检测」按钮删除后它是唯一入口）。 */
  openConnectionCheck: () => void
  openExternal: (url: string) => void
  revealApiKey: RevealModelProviderApiKey
}

type ModelServiceProviderPageProps = {
  labels: PlatformText['models']
  /** PLAT-62 追加：详情页「需代理」说明只在中文界面出现（由 AppShell 传入语言）。 */
  language: AppLanguage
  statusText: { saved: string; failed: string }
  providers: readonly SafeModelProvider[]
  filteredProviders: readonly SafeModelProvider[]
  selectedProvider: SafeModelProvider | null
  selectedProviderId: string | null
  providerSearch: string
  enabled: boolean
  apiKeyDraft: string
  modelGroups: readonly ModelGroup[]
  collapsedGroups: ReadonlySet<string>
  connectionStatus: string | null
  isSyncingModels: boolean
  notice: string | null
  syncError: ModelSyncErrorState | null
  actions: ModelServiceProviderPageActions
  onProviderSearchChange: (value: string) => void
  onSelectProvider: (providerId: string) => void
  onAddProvider: () => void
  onApiKeyDraftChange: (value: string) => void
  onToggleGroup: (groupName: string) => void
  overlays?: ReactNode
}

export function ModelServiceProviderPage({
  labels,
  language,
  statusText,
  providers,
  filteredProviders,
  selectedProvider,
  selectedProviderId,
  providerSearch,
  enabled,
  apiKeyDraft,
  modelGroups,
  collapsedGroups,
  connectionStatus,
  isSyncingModels,
  notice,
  syncError,
  actions,
  onProviderSearchChange,
  onSelectProvider,
  onAddProvider,
  onApiKeyDraftChange,
  onToggleGroup,
  overlays
}: ModelServiceProviderPageProps): React.ReactElement {
  const autosave = useModelServiceAutosave(statusText.failed)
  const [pendingEnabled, setPendingEnabled] = useState<boolean | null>(null)
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false)
  const [pendingRemove, setPendingRemove] = useState<SafeModelProvider | null>(null)
  // 摘要态三个入口（地址框 / 齿轮 / 添加端点）都开同一个抽屉。
  const [requestConfigOpen, setRequestConfigOpen] = useState(false)

  // 切换供应商时清掉上一家的 pending/行内错误（已保存提示也一起收掉，避免张冠李戴）。
  const resetAutosave = autosave.reset
  useEffect(() => {
    resetAutosave()
  }, [resetAutosave, selectedProviderId])

  // prop 变化（保存成功后的 refresh / 切换供应商）即清掉乐观值；失败时显式回滚。
  const enabledBaseline = `${selectedProviderId ?? ''}:${enabled ? 'on' : 'off'}`
  const [enabledBaselineSeen, setEnabledBaselineSeen] = useState(enabledBaseline)
  if (enabledBaselineSeen !== enabledBaseline) {
    setEnabledBaselineSeen(enabledBaseline)
    setPendingEnabled(null)
  }

  const displayEnabled = pendingEnabled ?? enabled
  const provider = selectedProvider
  // 配好 / 模型变更后自动检测「新增 / 变更 / 结论过期」的聊天模型（结果由主进程落库）。
  const autoDetection = useAutoModelDetection({ provider })
  const autoDetectionHint = autoDetection !== null && autoDetection.skipped > 0
    ? labels.autoDetectionTruncated(autoDetection.started, autoDetection.skipped)
    : null
  // PLAT-62 追加：proxy 供应商 + 中文界面 ⇒ 品牌块下方提示（布尔由页面算，组件不读全局）。
  const showMainlandProxyNotice =
    provider !== null && language === 'zh-CN' && providerReachabilityOf(provider.id) === 'proxy'
  // 实测结论：这家列表不返回（或只返回部分）协议支持 ⇒ 顶部黄色提示，说明要先去「检测模型」。
  // 唯一判据在 `needsModelProtocolNotice`（显式名单，见 providerProtocolDeclaration），
  // 页面不再按 coverage 档位二次推导 —— 之前两处各判一次，页面那份漏了 DeepSeek。
  const showProtocolNotice = provider !== null && needsModelProtocolNotice(provider.id, provider.models)
  const protocolNoticeKey = provider === null ? '' : protocolNoticeStorageKey(provider.id)
  const [dismissedProtocolNotice, setDismissedProtocolNotice] = useState<string | null>(null)
  const protocolNoticeDismissed =
    protocolNoticeKey !== '' &&
    (dismissedProtocolNotice === protocolNoticeKey || readProtocolNoticeDismissed(protocolNoticeKey))
  const dismissProtocolNotice = (): void => {
    setDismissedProtocolNotice(protocolNoticeKey)
    writeProtocolNoticeDismissed(protocolNoticeKey)
  }
  // PLAT-61：模型列表是只读拉取 ⇒ 有 baseUrl + 有 Key 即可，不要求供应商已启用。
  const hasProviderApiKey = Boolean(provider?.hasApiKey || apiKeyDraft.trim().length > 0)
  const canSyncModels = hasProviderApiKey && Boolean(provider?.baseUrl.trim())

  function toggleEnabled(next: boolean): void {
    if (!provider || autosave.isPending('enabled')) return
    setPendingEnabled(next)
    void autosave.run('enabled', () => actions.setProviderEnabled(next), () => setPendingEnabled(null))
  }

  function saveKeyDraft(): void {
    if (!provider || apiKeyDraft.trim().length === 0) return
    void autosave.run('apiKey', actions.saveApiKeyDraft, actions.clearApiKeyDraft)
  }

  /** T4/T5：默认端点改动即存；失败由 autosave 回滚选择并给行内错误。 */
  /** T4/T5：保存整份端点清单（改地址 / 添加 / 删除 / 设为默认都是同一次写）。 */
  async function saveEndpoints(endpoints: readonly ProviderChatEndpoint[]): Promise<boolean> {
    return autosave.run('endpoints', () => actions.saveEndpoints(endpoints))
  }

  /** 图像端点保存（与聊天端点不同维度，单独一次写）。 */
  async function saveImageEndpoint(kind: 'generation' | 'edit', value: string | undefined): Promise<boolean> {
    return autosave.run(`imageEndpoint:${kind}`, () => actions.saveImageEndpoint(kind, value))
  }

  async function removeModel(modelId: string): Promise<boolean> {
    return autosave.run(`model:${modelId}`, () => actions.removeModel(modelId))
  }

  /** PLAT-72：清空全部模型（含预设模型）；成功 toast，失败由 autosave 行内展示。 */
  async function clearAllModels(): Promise<boolean> {
    if (!provider) return false
    const count = provider.models.length
    if (count === 0) return false
    const ok = await autosave.run('model:clearAll', () => actions.clearAllModels())
    if (ok) message.success(labels.modelsClearedToast(count))
    return ok
  }

  const keyError = autosave.errorFor('apiKey')
  const removeError = autosave.errorFor('removeProvider')
  const enabledError = autosave.errorFor('enabled')
  const isRemovingModel = [...autosave.pending].some((key) => key.startsWith('model:'))
  const titleLink = provider ? provider.websites?.official ?? provider.websites?.apiKey : undefined
  // PLAT-81：品牌块 meta 与模型区计数同口径（归档的旧预设模型不计入）。
  const modelCount = provider ? provider.models.filter((model) => model.presetStale !== true).length : 0
  // 「供应商控制台」的落点按“有没有 Key”分流：
  //   没填 Key ⇒ 走邀请链接（注册还能拿到额度返还）；我们没配邀请链接时退回官方控制台。
  //   已填 Key ⇒ 直接进真正的控制台/官网，不再走注册引导。
  const consoleUrl = provider
    ? provider.hasApiKey
      ? provider.websites?.official ?? provider.websites?.apiKey
      : resolveProviderKeyUrl(provider.id) ?? provider.websites?.official ?? provider.websites?.apiKey
    : undefined
  // 「获取密钥」的唯一解析口径：我们自己的邀请链接优先 → 预设 key 页（每家云端供应商都有）。
  // 两者都缺（本地 / CLI 类、自定义供应商）才回落到控制台/官网，至少让用户有入口（文案会区分）。
  // 同一分流规则也适用于「获取密钥」：
  //   没填 Key ⇒ 邀请链接（注册即返利）；已填 Key ⇒ 真正的 key 页，不再走邀请注册。
  const keyUrl = provider
    ? provider.hasApiKey
      ? resolveProviderKeyUrl(provider.id, {}) ?? provider.websites?.apiKey
      : resolveProviderKeyUrl(provider.id) ?? provider.websites?.apiKey
    : undefined

  return (
    <section className="settings-workspace model-service-page" data-model-service-page>
      <ModelServiceProviderRail
        labels={labels}
        providers={filteredProviders}
        totalProviderCount={providers.length}
        selectedProviderId={selectedProviderId}
        search={providerSearch}
        onSearchChange={onProviderSearchChange}
        onSelect={onSelectProvider}
        onAdd={onAddProvider}
        onToggleProvider={(target) => void actions.setProviderEnabledById(target.id, !target.enabled)}
        onDeleteProvider={(target) => {
          setPendingRemove(target)
          setRemoveConfirmOpen(true)
        }}
      />

      <div className="model-service-detail">
        {provider === null ? (
          <p className="model-service-empty">{labels.noProviders}</p>
        ) : (
          <>
            {removeError !== null ? (
              <p className="model-service-inline-error" role="alert" data-provider-delete-error>
                {removeError}
              </p>
            ) : null}

            {enabledError !== null ? (
              <p className="model-service-inline-error" role="alert" data-provider-enable-error>
                {enabledError}
              </p>
            ) : null}

            {showProtocolNotice && !protocolNoticeDismissed ? (
              <ModelServiceProtocolNotice
                labels={labels}
                providerName={resolveProviderDisplayName(labels, provider)}
                onDismiss={dismissProtocolNotice}
              />
            ) : null}

            <ModelServiceBrandBlock
              labels={labels}
              provider={provider}
              savedHint={autosave.saved ? statusText.saved : null}
              consoleUrl={consoleUrl}
              titleLink={titleLink}
              enabled={displayEnabled}
              enabledPending={autosave.isPending('enabled')}
              onToggleEnabled={toggleEnabled}
              showMainlandProxyNotice={showMainlandProxyNotice}
              onOpenConnectionCheck={actions.openConnectionCheck}
              onOpenExternal={actions.openExternal}
              onRemoveProvider={() => {
                setPendingRemove(provider)
                setRemoveConfirmOpen(true)
              }}
              removeProviderDisabled={autosave.isPending('removeProvider')}
            />

            <ModelServiceKeySection
              labels={labels}
              provider={provider}
              apiKeyDraft={apiKeyDraft}
              onApiKeyDraftChange={onApiKeyDraftChange}
              onSaveDraft={saveKeyDraft}
              error={keyError ?? removeError}
              // 主路径 = `resolveProviderKeyUrl`（邀请链接 → 每家都有的 key 页）；
              // `official` 只是极端兜底，`getKeyFromConsole` 让文案说清这是控制台入口。
              getKeyUrl={keyUrl ?? provider.websites?.official}
              getKeyFromConsole={keyUrl === undefined}
              onOpenExternal={actions.openExternal}
              statusMessage={connectionStatus}
              revealApiKey={actions.revealApiKey}
            />

            <ModelServiceApiAddressSection
              labels={labels}
              provider={provider}
              onOpenRequestConfig={() => setRequestConfigOpen(true)}
            />

            <ModelServiceModelsSection labels={labels} provider={provider}
              configuredProtocolCount={configuredModelChatProtocols(provider).length}
              autoDetectionHint={autoDetectionHint}
              groups={modelGroups}
              modelCount={modelCount}
              staleModelCount={provider.models.filter((model) => model.presetStale === true).length}
              collapsedGroups={collapsedGroups}
              onToggleGroup={onToggleGroup}
              onSyncModels={actions.previewModelSync}
              onClearModels={clearAllModels}
              isSyncing={isSyncingModels}
              canSyncModels={canSyncModels}
              canAddModel={hasProviderApiKey}
              onAddModel={actions.openAddModel}
              onEditModel={actions.openEditModel}
              onRemoveModel={removeModel}
              isRemovingModel={isRemovingModel}
              modelError={autosave.errorForPrefix('model:')}
              notice={notice}
              syncErrorText={syncError === null ? null : formatModelSyncFailureText(syncError.reasonCode, labels, syncError.upstreamMessage)}
              syncErrorDetail={resolveModelSyncFailureDetail(syncError, labels)}
            />
          </>
        )}
      </div>
      <Modal
        title={labels.removeProvider}
        open={removeConfirmOpen}
        centered
        width={420}
        okText={labels.removeProvider}
        cancelText={labels.cancel}
        okButtonProps={{ danger: true, 'data-remove-provider-confirm-button': true } as never}
        cancelButtonProps={{ 'data-remove-provider-cancel': true } as never}
        onOk={() => {
          setRemoveConfirmOpen(false)
          const target = pendingRemove ?? provider
          void autosave.run('removeProvider', target ? () => actions.removeProviderById(target.id) : actions.removeProvider)
        }}
        onCancel={() => {
          setRemoveConfirmOpen(false)
          setPendingRemove(null)
        }}>
        <p data-remove-provider-confirm>
          {labels.removeProviderConfirm((pendingRemove ?? provider) ? resolveProviderDisplayName(labels, (pendingRemove ?? provider)!) : '')}
        </p>
      </Modal>

      {provider !== null ? (
        <ModelServiceRequestConfigDrawer
          open={requestConfigOpen}
          labels={labels}
          provider={provider}
          onClose={() => setRequestConfigOpen(false)}
          onSaveEndpoints={(endpoints) => saveEndpoints(endpoints).then(() => undefined)}
          onSaveImageEndpoint={(kind, value) => saveImageEndpoint(kind, value).then(() => undefined)}
          savingDefaultEndpoint={autosave.isPending('endpoints')}
        />
      ) : null}

      {overlays}
    </section>
  )
}
