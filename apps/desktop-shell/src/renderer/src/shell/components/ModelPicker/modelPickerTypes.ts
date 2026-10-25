import type { ModelDefinition, ModelPriceTag } from '@platform/ai/providers/modelProviderTypes'

import type { ModelAvailabilityView } from '../../model-service/modelAvailabilityView'
import type { ModelProtocolTab } from '../../model-service/modelProtocolFilter'

/**
 * 标准化模型选择器的**契约类型**（数据层与 UI 共用）。
 *
 * 调用点约束（唯一事实，新增调用点只加一行，不改组件内部）：
 *  | 调用点                     | constraints                                                                            |
 *  | 智能体工具栏                | `{ requireCapabilities: ['chat'], protocols: ['messages'], showProtocolFilter: true }`  |
 *  | `@` 提及面板（智能体上下文）  | `{ requireCapabilities: ['chat'], protocols: ['messages'] }`                            |
 *  | 助手页顶部                  | `{ requireCapabilities: ['chat'] }`                                                     |
 *  | 默认·助手 / 快速 / 翻译      | `{ requireCapabilities: ['chat'] }`                                                     |
 *  | 默认·智能体                 | `{ requireCapabilities: ['chat'], protocols: ['messages'], showProtocolFilter: true }`  |
 *  | 默认·绘画                   | `{ requireCapabilities: ['imageGeneration'], showProtocolFilter: false }`               |
 *  | 智能体配置·主/规划/小模型     | `{ requireCapabilities: ['chat'], protocols: ['messages'] }`                            |
 */
export type ModelPickerCategory = 'vision' | 'audio' | 'video' | 'reasoning' | 'tools' | 'deal'

/** chip 顺序固定；`deal` 放最后（不是能力，是价格：折扣或免费）。 */
export const MODEL_PICKER_CATEGORIES: readonly ModelPickerCategory[] = [
  'vision',
  'audio',
  'video',
  'reasoning',
  'tools',
  'deal'
]

/** 价格标签：`free` = 免费，`discount` = 有折扣但仍收费。免费优先（同一条模型只显示一个标签）。 */
export type ModelPickerPriceTag = Exclude<ModelPriceTag, 'paid'>

/** `chat` / `imageGeneration` 声明「文本类入口」与「绘画入口」的候选范围。 */
export type ModelPickerCapabilityRequirement =
  | 'chat'
  | 'vision'
  | 'audio'
  | 'videoGeneration'
  | 'reasoning'
  | 'tools'
  | 'imageGeneration'

export type ModelPickerConstraints = {
  /** 只允许这些协议（按已声明协议判定）；省略 = 不限。 */
  protocols?: readonly ModelProtocolTab[]
  /** 必须同时具备的能力（AND）；省略 = 不限。 */
  requireCapabilities?: readonly ModelPickerCapabilityRequirement[]
  /** 默认 true：过滤掉已下线（`probeReason === 'model_retired'`）。 */
  excludeRetired?: boolean
  /** 分类筛选里显示哪些 chip；省略 = 六个全显示。 */
  categories?: readonly ModelPickerCategory[]
  /** 是否显示协议筛选行；省略 = 显示。 */
  showProtocolFilter?: boolean
  /**
   * 是否把**已停用厂商**的模型也列出来；默认 false（只列 `provider.enabled === true`）。
   * 仅留给调试/迁移，组件不暴露。
   */
  includeDisabledProviders?: boolean
  /** 底部跳转按钮；省略 = 显示默认「配置自定义模型」。 */
  footer?: { label?: string } | false
}

/** 调用方候选：模型必须带上所属供应商，`value` 恒为 `providerId:modelId`。 */
export type ModelPickerCandidate = {
  providerId: string
  model: ModelDefinition
}

export type ModelPickerOption = {
  value: string
  providerId: string
  /** 厂商展示名（`resolveProviderDisplayName`），组标题与触发器共用。 */
  providerName: string
  modelId: string
  modelName: string
  categories: readonly ModelPickerCategory[]
  /** 价格标签（免费 / 折扣），列表里显示在模型名前；`null` = 普通付费模型。 */
  priceTag: ModelPickerPriceTag | null
  /** 该模型**已声明**的协议（协议筛选口径，见 `modelPickerProtocols`）。 */
  protocols: readonly ModelProtocolTab[]
  /** 上次检测的可用性结论（含是否过期）；从未检测 ⇒ 缺省。 */
  availability?: ModelAvailabilityView
  /** 小写搜索文本：模型名 + 模型 id + 厂商展示名 + 厂商 id。 */
  searchText: string
}

export type ModelPickerGroup = {
  providerId: string
  providerName: string
  options: ModelPickerOption[]
}

export type ModelPickerChip<TKey extends string> = {
  key: TKey
  count: number
}

export type ModelPickerOptions = {
  groups: ModelPickerGroup[]
  options: ModelPickerOption[]
  /** 调用方传入的候选数（含被停用厂商/已下线过滤掉的）。 */
  inputCount: number
  /** 因 `probeReason === 'model_retired'` 被剔除的数量（空态文案用）。 */
  retiredExcludedCount: number
  /** 调用点用途（由 constraints 推导，空态文案据此给具体原因）。 */
  scope: ModelPickerScope
  /** 分类 chip：只含 constraints.categories 声明过的项。 */
  categories: Array<ModelPickerChip<ModelPickerCategory>>
  /** 协议 chip：`showProtocolFilter === false` 时为空数组。 */
  protocols: Array<ModelPickerChip<ModelProtocolTab>>
  showProtocolFilter: boolean
  footer: { label?: string } | null
}

/**
 * 空态原因（由 constraints 推导，组件不写 if）：
 *  - `no-match`：有候选，但搜索/筛选后为空；
 *  - `retired-only`：有候选，但全被「已下线」过滤掉；
 *  - `no-messages` / `no-image`：调用点的约束（智能体 / 绘画）导致没有可用模型；
 *  - `no-models`：通用兜底。
 */
export type ModelPickerScope = 'agent' | 'image' | 'text' | 'other'

export type ModelPickerEmptyReason =
  | 'no-match'
  | 'retired-only'
  | 'no-messages'
  | 'no-image'
  | 'no-models'

export type ModelPickerEmptyState = {
  reason: ModelPickerEmptyReason
  title: string
  hint: string | null
}

export type ModelPickerFilters = {
  query: string
  /** 多选 AND：每个选中的分类都要命中。 */
  categories: readonly ModelPickerCategory[]
  /** 多选 AND：每个选中的协议都要在已声明协议里。 */
  protocols: readonly ModelProtocolTab[]
}

export const emptyModelPickerFilters: ModelPickerFilters = {
  query: '',
  categories: [],
  protocols: []
}

