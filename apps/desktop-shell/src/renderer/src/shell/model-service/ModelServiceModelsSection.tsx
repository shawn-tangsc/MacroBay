import { useState } from 'react'
import { ChevronRight, Filter, Plus, RefreshCw, Search } from 'lucide-react'

import type { ModelDefinition, SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import type { PlatformText } from '../../i18n/platformText'
import type { ModelGroup } from '../modelGrouping'

import { resolveModelAvailabilityView } from './autoModelDetectionPlan'
import { ModelServiceClearModelsControl } from './ModelServiceClearModelsControl'
import { ModelServiceDetectControl } from './ModelServiceDetectControl'
import { ModelServiceModelRow } from './ModelServiceModelRow'
import { useModelDetection } from './useModelDetection'
import {
  buildModelTypeCounts,
  matchesModelType,
  ModelServiceModelTypeFilter,
  type ModelTypeTab
} from './ModelServiceModelTypeFilter'
import { ModelServiceProtocolFilter } from './ModelServiceProtocolFilter'
import {
  buildModelProtocolCounts,
  emptyModelProtocolFilter,
  matchesModelProtocol,
  type ModelProtocolFilter,
  type ModelProtocolTab
} from './modelProtocolFilter'

/**
 * PLAT-61：模型分区。
 *
 * PLAT-81：筛选区 = 两行 pill（模型类型 + 聊天协议），可叠加（AND）；漏斗按钮统一折叠/展开这两行。
 * 协议 pill 是**筛选器**（每项带计数），不是统计行。
 */
type ModelServiceModelsSectionProps = {
  labels: PlatformText['models']
  /** 供应商（行内可用性结论要用端点 + Key 掩码判过期；`id` 用于检测视图）。 */
  provider: SafeModelProvider
  /** PLAT-82：该供应商已配置的协议通道数（检测弹窗的"只有 1 条协议可测"）。 */
  configuredProtocolCount?: number
  groups: readonly ModelGroup[]
  modelCount: number
  /** PLAT-63 C：归档的旧预设模型数量（不计入 modelCount；提示可在同步预览里清理）。 */
  staleModelCount: number
  collapsedGroups: ReadonlySet<string>
  onToggleGroup: (groupName: string) => void
  onSyncModels: () => void
  /** PLAT-72：清空该供应商全部模型（含预设模型），返回是否成功。 */
  onClearModels: () => Promise<boolean>
  isSyncing: boolean
  /** 有 baseUrl + 有 Key 即可拉取（**不要求启用**：只读拉取，便于先看免费模型再决定启用）。 */
  canSyncModels: boolean
  /** 没有 Key 时不允许新增模型（与同步同一口径；停用不影响）。 */
  canAddModel: boolean
  onAddModel: () => void
  onEditModel: (model: ModelDefinition) => void
  onRemoveModel: (modelId: string) => Promise<boolean>
  /** 任一模型正在移除时，暂停其它移除（避免连点打乱 refresh 顺序）。 */
  isRemovingModel: boolean
  modelError: string | null
  notice: string | null
  /** PLAT-61 A：同步失败的人话（已含「获取模型列表失败：」前缀）。 */
  syncErrorText: string | null
  /** A：原始信息（安全、已去前缀）；只有可读时才展示。 */
  syncErrorDetail: string | null
  /** 自动检测因单批上限没测完时的提示（不发请求也能看到还差多少）。 */
  autoDetectionHint?: string | null
}

export function ModelServiceModelsSection({
  labels,
  provider,
  configuredProtocolCount,
  groups,
  modelCount,
  staleModelCount,
  collapsedGroups,
  onToggleGroup,
  onSyncModels,
  onClearModels,
  isSyncing,
  canSyncModels,
  canAddModel,
  onAddModel,
  onEditModel,
  onRemoveModel,
  isRemovingModel,
  modelError,
  notice,
  syncErrorText,
  syncErrorDetail,
  autoDetectionHint
}: ModelServiceModelsSectionProps): React.ReactElement {
  const providerId = provider.id
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [activeType, setActiveType] = useState<ModelTypeTab>('all')
  const [activeProtocols, setActiveProtocols] = useState<ModelProtocolFilter>(emptyModelProtocolFilter)
  const syncDisabled = !canSyncModels || isSyncing
  // 禁用原因要可见：无 Key / 同步中；其它情况不显示 tooltip。
  const syncHint = !canSyncModels ? labels.modelSyncNeedsApiKey : isSyncing ? labels.modelSyncInProgress : undefined
  const addHint = canAddModel ? labels.addModel : labels.modelSyncNeedsApiKey

  // PLAT-82：本会话的检测结果只读视图（不落库；切页/切供应商不清空）。
  const detection = useModelDetection(providerId)
  const keyword = search.trim().toLowerCase()
  const allModels = groups.flatMap((group) => group.models)
  const counts = buildModelTypeCounts(allModels)
  // T4/T5：协议 pill 只看模型自带的协议（不读供应商默认端点）。
  const protocolCounts = buildModelProtocolCounts(allModels)
  const toggleProtocol = (tab: ModelProtocolTab): void => {
    setActiveProtocols((current) => ({ ...current, [tab]: !current[tab] }))
  }
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      models: group.models.filter((model) => {
        if (!matchesModelType(model, activeType)) return false
        // 协议与类型都是 AND；协议一个都没选 = 不过滤。
        if (!matchesModelProtocol(model, activeProtocols)) return false
        if (!keyword) return true
        return model.name.toLowerCase().includes(keyword) || model.id.toLowerCase().includes(keyword)
      })
    }))
    .filter((group) => group.models.length > 0)

  const filterLabel = filtersOpen ? labels.hideModelFilters : labels.showModelFilters

  return (
    <section className="model-service-section model-service-models" data-model-service-models>
      <div className="model-service-section-head">
        <span className="model-service-section-title">
          {labels.modelsHeading}
          <span className="model-service-count" data-models-count>{modelCount}</span>
        </span>
        <span className="model-service-head-tools">
          <button
            type="button"
            className="model-service-head-icon"
            data-models-filter-toggle
            title={filterLabel}
            aria-label={filterLabel}
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((current) => !current)}>
            <Filter size={13} />
          </button>
          <button
            type="button"
            className="model-service-head-icon"
            data-models-search-toggle
            title={labels.modelSearch}
            aria-label={labels.modelSearch}
            aria-pressed={searchOpen}
            onClick={() => setSearchOpen((current) => !current)}>
            <Search size={13} />
          </button>
        </span>
        <span className="model-service-head-actions">
          <ModelServiceDetectControl
            labels={labels}
            models={allModels}
            {...(configuredProtocolCount === undefined ? {} : { configuredProtocolCount })}
            detection={detection}
          />
          <button
            type="button"
            className="model-service-pill"
            data-models-sync
            disabled={syncDisabled}
            title={syncHint}
            aria-label={syncHint ?? labels.fetchModelList}
            onClick={onSyncModels}>
            <RefreshCw size={13} aria-hidden="true" />
            {labels.fetchModelList}
          </button>
          <ModelServiceClearModelsControl
            labels={labels}
            modelCount={modelCount + staleModelCount}
            disabled={isSyncing || isRemovingModel}
            onConfirm={onClearModels}
          />
          <button
            type="button"
            className="model-service-pill model-service-pill-icon"
            data-models-add
            disabled={!canAddModel}
            title={addHint}
            aria-label={addHint}
            onClick={onAddModel}>
            <Plus size={13} aria-hidden="true" />
          </button>
        </span>
      </div>

      {staleModelCount > 0 ? (
        <p className="model-service-stale-hint" data-models-stale-hint>
          {labels.modelSyncStaleHint(staleModelCount)}
        </p>
      ) : null}

      {/*
        漏斗折叠的是**两行 pill**（类型 + 协议）：折叠时容器 display:none（`hidden`）且内部不渲染任何 pill，
        工具条位置不动；容器自身没有 padding/border/min-height，收起后不会残留一条细线。
      */}
      <div
        className="model-service-filter-rows"
        data-model-filters
        hidden={!filtersOpen}>
        {filtersOpen ? (
          <>
            <ModelServiceModelTypeFilter
              labels={labels}
              active={activeType}
              counts={counts}
              onChange={setActiveType}
            />
            <ModelServiceProtocolFilter
              labels={labels}
              active={activeProtocols}
              counts={protocolCounts}
              onToggle={toggleProtocol}
            />
          </>
        ) : null}
      </div>

      {searchOpen ? (
        <label className="model-service-model-search">
          <Search size={13} aria-hidden="true" />
          <input
            data-models-search
            type="search"
            value={search}
            placeholder={labels.modelSearch}
            aria-label={labels.modelSearch}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      ) : null}

      {syncErrorText !== null ? (
        <p className="model-service-sync-error" data-models-sync-error role="alert">
          <span>{syncErrorText}</span>
          <button
            type="button"
            className="model-service-link"
            data-models-sync-retry
            disabled={isSyncing}
            onClick={onSyncModels}>
            {labels.retry}
          </button>
          {syncErrorDetail !== null ? (
            <small className="model-service-sync-detail" data-models-sync-detail>
              {labels.connectionCheckDetailPrefix}
              {syncErrorDetail}
            </small>
          ) : null}
        </p>
      ) : null}
      {notice !== null ? <p className="model-service-hint" data-models-notice>{notice}</p> : null}
      {autoDetectionHint !== null && autoDetectionHint !== undefined ? (
        <p className="model-service-hint" data-models-auto-detection-hint>{autoDetectionHint}</p>
      ) : null}
      {modelError !== null ? (
        <p className="model-service-inline-error" role="alert" data-models-error>
          {modelError}
        </p>
      ) : null}

      {modelCount === 0 ? <p className="model-service-empty">{labels.noModels}</p> : null}
      {visibleGroups.length === 0 ? (
        <p className="model-service-empty">{modelCount === 0 ? labels.noModels : labels.noMatchedModels}</p>
      ) : null}

      <div className="model-service-groups" data-model-list-scroll>
        {visibleGroups.map((group) => {
          const collapsed = collapsedGroups.has(group.name)
          return (
            <section key={group.name} className="model-service-group" data-model-group={group.name}>
              <button
                type="button"
                className="model-service-group-header"
                data-model-group-toggle
                aria-expanded={!collapsed}
                onClick={() => onToggleGroup(group.name)}>
                <ChevronRight size={14} className={collapsed ? 'model-service-chevron' : 'model-service-chevron open'} />
                <strong>{group.name}</strong>
                <small>{group.models.length}</small>
              </button>
              {collapsed ? null : (
                <div className="model-service-group-body">
                  {group.models.map((model) => (
                    <ModelServiceModelRow
                      key={model.id}
                      labels={labels}
                      providerId={providerId}
                      model={model}
                      availability={resolveModelAvailabilityView(provider, model)}
                      detectionStatus={detection.statusFor(model.id)}
                      detectionResult={detection.resultFor(model.id)}
                      isRemovingModel={isRemovingModel}
                      onEditModel={onEditModel}
                      onRemoveModel={onRemoveModel}
                    />
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </section>
  )
}
