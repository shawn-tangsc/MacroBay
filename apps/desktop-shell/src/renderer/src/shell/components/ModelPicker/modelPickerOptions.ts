import { resolveModelPriceTag } from '@platform/ai/providers/modelPriceTag'
import { resolveModelCapabilities } from '@platform/ai/providers/modelCapabilityInference'
import type { ModelDefinition, SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import type { PlatformText } from '../../../i18n/platformText'
import { resolveModelAvailabilityView } from '../../model-service/modelAvailabilityView'
import { resolveProviderDisplayName } from '../../model-service/providerDisplayName'
import {
  MODEL_PICKER_PROTOCOL_ORDER,
  isMessagesCapableModel,
  resolveModelPickerProtocols
} from './modelPickerProtocols'
import { matchesModelPickerQuery } from './modelPickerSearch'

import { MODEL_PICKER_CATEGORIES } from './modelPickerTypes'
import type {
  ModelPickerCandidate,
  ModelPickerCategory,
  ModelPickerChip,
  ModelPickerConstraints,
  ModelPickerEmptyState,
  ModelPickerFilters,
  ModelPickerGroup,
  ModelPickerCapabilityRequirement,
  ModelPickerOption,
  ModelPickerOptions,
  ModelPickerPriceTag,
  ModelPickerScope
} from './modelPickerTypes'

export * from './modelPickerTypes'
export { isMessagesCapableModel, resolveModelPickerProtocols } from './modelPickerProtocols'
export { matchesModelPickerQuery } from './modelPickerSearch'
export { isFreeModel, isFreePricedModel } from '@platform/ai/providers/modelFreeStatus'

/**
 * 标准化模型选择器的**唯一数据层**（可单测）。
 *
 * 三处下拉、智能体配置页与 `@` 提及面板都从这里取分组/搜索/筛选数据，UI 只渲染，不重算：
 *  - 候选 = 调用方给的 `models`（各页自己的领域范围，例如智能体候选）；
 *  - 差异 = 调用方的 `ModelPickerConstraints`（协议 / 能力 / 停用厂商 / 去掉已下线 / chip / 底部按钮）；
 *  - 已停用厂商与已下线（`probeReason === 'model_retired'`）默认剔除；「未验证」概念已从应用移除。
 * 调用点约束表见 `modelPickerTypes.ts`。
 */
export function buildModelPickerOptions(
  models: readonly ModelPickerCandidate[],
  providers: readonly SafeModelProvider[],
  constraints: ModelPickerConstraints = {},
  labels: Pick<PlatformText['models'], 'providerNames'> = { providerNames: {} }
): ModelPickerOptions {
  const providerById = new Map(providers.map((provider) => [provider.id, provider]))
  const showProtocolFilter = constraints.showProtocolFilter !== false
  const allowedCategories = constraints.categories ?? MODEL_PICKER_CATEGORIES
  const seenValues = new Set<string>()
  const options: ModelPickerOption[] = []
  let retiredExcludedCount = 0

  for (const candidate of models) {
    const provider = providerById.get(candidate.providerId)
    if (!provider) continue
    // 顺序：启用厂商 → 已下线 → 能力/协议（约束）。已停用厂商的模型一律不进候选。
    if (constraints.includeDisabledProviders !== true && provider.enabled !== true) continue
    const { model } = candidate
    if (constraints.excludeRetired !== false && model.probeReason === 'model_retired') {
      retiredExcludedCount += 1
      continue
    }
    const capabilities = resolveModelCapabilities(model)
    // OCR 模型仍是 `chat: true` 的 VLM（见 modelCapabilityInference）：它能被 chat/completions
    // 调起，因此**允许**进聊天候选；这里不按能力白名单把它当非聊天剔除。
    if (!meetsRequiredCapabilities(capabilities, constraints.requireCapabilities)) continue
    const protocols = resolveModelPickerProtocols(provider, model)
    if (constraints.protocols && !constraints.protocols.some((protocol) => protocols.includes(protocol))) continue
    const value = `${provider.id}:${model.id}`
    if (seenValues.has(value)) continue
    seenValues.add(value)
    const providerName = resolveProviderDisplayName(labels, provider)
    const availability = resolveModelAvailabilityView(provider, model)
    options.push({
      value,
      providerId: provider.id,
      providerName,
      modelId: model.id,
      modelName: model.name,
      categories: resolveModelPickerCategories(capabilities, model),
      priceTag: resolveModelPickerPriceTag(model),
      protocols,
      ...(availability ? { availability } : {}),
      searchText: `${model.name} ${model.id} ${providerName} ${provider.id}`.toLowerCase()
    })
  }

  return {
    groups: groupModelPickerOptions(options),
    options,
    inputCount: models.length,
    retiredExcludedCount,
    scope: resolveModelPickerScope(constraints),
    categories: allowedCategories.map((key) => ({
      key,
      count: options.filter((option) => option.categories.includes(key)).length
    })),
    protocols: showProtocolFilter
      ? MODEL_PICKER_PROTOCOL_ORDER.map((key) => ({
        key,
        count: options.filter((option) => option.protocols.includes(key)).length
      }))
      : [],
    showProtocolFilter,
    footer: constraints.footer === false ? null : (constraints.footer ?? {})
  }
}

/** 按厂商分组（组标题 = 厂商展示名），组内按模型名排序；同名模型不去重。 */
function groupModelPickerOptions(options: readonly ModelPickerOption[]): ModelPickerGroup[] {
  const groups: ModelPickerGroup[] = []
  const byProvider = new Map<string, ModelPickerGroup>()
  for (const option of options) {
    let group = byProvider.get(option.providerId)
    if (!group) {
      group = { providerId: option.providerId, providerName: option.providerName, options: [] }
      byProvider.set(option.providerId, group)
      groups.push(group)
    }
    group.options.push(option)
  }
  for (const group of groups) {
    group.options.sort((left, right) => left.modelName.localeCompare(right.modelName))
  }
  return groups
}

/**
 * 价格标签（列表里显示在模型名前）：读归一后的 `priceTag` —— 免费优先，
 * 折扣只给仍收费的模型。`paid` 在列表里不显示标签，所以映射成 `null`。
 */
export function resolveModelPickerPriceTag(
  model: Pick<ModelDefinition, 'pricing' | 'freeOverride' | 'priceTag'>
): ModelPickerPriceTag | null {
  const tag = resolveModelPriceTag(model)
  return tag === 'paid' ? null : tag
}

/** 价格筛选分类 `deal` = 免费或折扣；折扣不算免费，但两者都在这个 chip 下。 */
export function resolveModelPickerCategories(
  capabilities: ReturnType<typeof resolveModelCapabilities>,
  model: Pick<ModelDefinition, 'pricing' | 'freeOverride' | 'priceTag'>
): ModelPickerCategory[] {
  const categories: ModelPickerCategory[] = []
  // `ocr` 不是选择器分类：它是「图片 → 文本」的专长标记。OCR 模型的 vision 由能力推断一起置位，
  // 所以它自然落在 `vision` 分类里，不额外造一个 OCR 分类。
  if (capabilities.vision === true) categories.push('vision')
  if (capabilities.speech === true || capabilities.transcription === true) categories.push('audio')
  if (capabilities.videoGeneration === true) categories.push('video')
  if (capabilities.reasoning === true) categories.push('reasoning')
  if (capabilities.tools === true) categories.push('tools')
  if (resolveModelPickerPriceTag(model) !== null) categories.push('deal')
  return categories
}

function meetsRequiredCapabilities(
  capabilities: ReturnType<typeof resolveModelCapabilities>,
  required: readonly ModelPickerCapabilityRequirement[] | undefined
): boolean {
  if (!required || required.length === 0) return true
  return required.every((key) => {
    if (key === 'audio') return capabilities.speech === true || capabilities.transcription === true
    return capabilities[key] === true
  })
}

export function matchesModelPickerOption(
  option: ModelPickerOption,
  filters: ModelPickerFilters
): boolean {
  if (!matchesModelPickerQuery(option.searchText, filters.query)) return false
  if (!filters.categories.every((category) => option.categories.includes(category))) return false
  return filters.protocols.every((protocol) => option.protocols.includes(protocol))
}

/** 应用搜索 + 分类 + 协议筛选；空分组直接丢掉。 */
export function filterModelPickerGroups(
  groups: readonly ModelPickerGroup[],
  filters: ModelPickerFilters
): ModelPickerGroup[] {
  return groups
    .map((group) => ({
      providerId: group.providerId,
      providerName: group.providerName,
      options: group.options.filter((option) => matchesModelPickerOption(option, filters))
    }))
    .filter((group) => group.options.length > 0)
}

/**
 * 空态文案的唯一推导处：`visibleCount === 0` 时按 constraints 给出具体原因（组件只渲染）。
 */
export function resolveModelPickerEmptyState(
  built: ModelPickerOptions,
  visibleCount: number,
  labels: Pick<PlatformText['models'],
    | 'pickerEmptyNoModels'
    | 'pickerEmptyNoMessages'
    | 'pickerEmptyNoMessagesHint'
    | 'pickerEmptyNoImage'
    | 'pickerEmptyNoImageHint'
    | 'pickerEmptyNoMatch'
    | 'pickerEmptyRetiredOnly'>
): ModelPickerEmptyState | null {
  if (visibleCount > 0) return null
  if (built.options.length > 0) {
    return { reason: 'no-match', title: labels.pickerEmptyNoMatch, hint: null }
  }
  if (built.retiredExcludedCount > 0 && built.retiredExcludedCount === built.inputCount) {
    return { reason: 'retired-only', title: labels.pickerEmptyRetiredOnly, hint: null }
  }
  if (built.scope === 'agent') {
    return {
      reason: 'no-messages',
      title: labels.pickerEmptyNoMessages,
      hint: labels.pickerEmptyNoMessagesHint
    }
  }
  if (built.scope === 'image') {
    return { reason: 'no-image', title: labels.pickerEmptyNoImage, hint: labels.pickerEmptyNoImageHint }
  }
  return { reason: 'no-models', title: labels.pickerEmptyNoModels, hint: null }
}

export function resolveModelPickerScope(constraints: ModelPickerConstraints): ModelPickerScope {
  if (constraints.requireCapabilities?.includes('imageGeneration')) return 'image'
  if (constraints.protocols?.includes('messages')) return 'agent'
  if (constraints.requireCapabilities?.includes('chat')) return 'text'
  return 'other'
}

export type ModelPickerSelection = {
  value: string
  modelName: string
  providerId: string
  providerName: string
  /** 选中值不在候选范围内（被删/下线/不满足约束）：只回显、不清空。 */
  outsideCandidates: boolean
  /** 选中值所属厂商已停用：回显 + 提示「厂商已停用」，不静默清空。 */
  providerDisabled: boolean
}

/** 触发器回显：候选里找不到就按 `providerId:modelId` 回退，绝不静默清空。 */
export function resolveModelPickerSelection(
  value: string | null,
  options: readonly ModelPickerOption[],
  providers: readonly SafeModelProvider[],
  labels: Pick<PlatformText['models'], 'providerNames'> = { providerNames: {} }
): ModelPickerSelection | null {
  if (!value) return null
  const option = options.find((entry) => entry.value === value)
  if (option) {
    const provider = providers.find((entry) => entry.id === option.providerId)
    return {
      value,
      modelName: option.modelName,
      providerId: option.providerId,
      providerName: option.providerName,
      outsideCandidates: false,
      providerDisabled: provider?.enabled !== true
    }
  }
  const separatorIndex = value.indexOf(':')
  const providerId = separatorIndex > 0 ? value.slice(0, separatorIndex) : ''
  const modelId = separatorIndex > 0 ? value.slice(separatorIndex + 1) : value
  const provider = providers.find((entry) => entry.id === providerId)
  return {
    value,
    modelName: provider?.models.find((model) => model.id === modelId)?.name ?? modelId,
    providerId,
    providerName: provider ? resolveProviderDisplayName(labels, provider) : providerId,
    outsideCandidates: true,
    providerDisabled: provider !== undefined && provider.enabled !== true
  }
}
