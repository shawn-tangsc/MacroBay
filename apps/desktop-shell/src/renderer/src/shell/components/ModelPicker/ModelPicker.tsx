import { useMemo, useState } from 'react'
import { Popover } from 'antd'
import { ChevronDown, X } from 'lucide-react'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { resolveProviderVisual } from '@platform/ui/icons/modelProviderVisuals'

import type { PlatformText } from '../../../i18n/platformText'
import { isAvailabilityProbeModel, resolveModelAvailabilityView } from '../../model-service/modelAvailabilityView'
import { ModelAvailabilityIcon } from '../../model-service/ModelAvailabilityIcon'
import type { ModelProtocolTab } from '../../model-service/modelProtocolFilter'
import { openModelServiceSettings } from '../../model-service/openModelServiceSettings'
import { getProviderIconUrl } from '../../visualIconAssets'
import { ModelPickerPanel } from './ModelPickerPanel'
import {
  buildModelPickerOptions,
  filterModelPickerGroups,
  resolveModelPickerSelection,
  type ModelPickerCandidate,
  type ModelPickerCategory,
  type ModelPickerConstraints,
  type ModelPickerOption,
  type ModelPickerSelection
} from './modelPickerOptions'

type ModelPickerProps = {
  /** 受控值，恒为 `providerId:modelId`。 */
  value: string | null
  onChange: (value: string) => void
  /** 候选范围（各调用点的领域范围，例如智能体候选）；约束差异走 `constraints`。 */
  models: readonly ModelPickerCandidate[]
  providers: readonly SafeModelProvider[]
  labels: PlatformText['models']
  constraints?: ModelPickerConstraints
  disabled?: boolean
  /** 允许清空（可选字段，例如智能体的规划/小模型）；清空走 `onClear`。 */
  allowClear?: boolean
  onClear?: () => void
  placement?: 'bottomLeft' | 'bottomRight' | 'topLeft'
  /** 便于测试与调用点定位的 data 属性值（渲染为 `data-model-picker`）。 */
  pickerId?: string
  /**
   * 未选择时的占位文案（例如「跟随默认：Anthropic / Claude」）。
   * 缺省走 `labels.pickerSelectModel`；只影响显示，不改变受控值。
   */
  placeholder?: string
  /** 默认走 `openModelServiceSettings`（唯一跳转口）。 */
  onOpenModelService?: () => void
  /** Replace the default trigger (the composer menu supplies its own row). */
  trigger?: React.ReactNode
  onOpenChange?: (open: boolean) => void
}

/**
 * 标准化模型选择器：可搜索、按厂商分组、分类/协议筛选（默认收起）、
 * 底部「配置自定义模型」。数据全部来自 `modelPickerOptions`（纯函数、可单测），组件只收集交互。
 *
 * 选中值不在候选里（被删 / 已下线 / 厂商停用 / 不满足约束）时只回显并给提示，绝不静默清空。
 */
export function ModelPicker({
  value,
  onChange,
  models,
  providers,
  labels,
  constraints,
  disabled = false,
  allowClear = false,
  onClear,
  placement = 'bottomLeft',
  pickerId,
  placeholder,
  onOpenModelService = openModelServiceSettings,
  trigger,
  onOpenChange
}: ModelPickerProps): React.ReactElement {
  const [open, setOpenInternal] = useState(false)
  const setOpen = (next: boolean): void => {
    setOpenInternal(next)
    onOpenChange?.(next)
  }
  const [query, setQuery] = useState('')
  const [categories, setCategories] = useState<ModelPickerCategory[]>([])
  const [protocols, setProtocols] = useState<ModelProtocolTab[]>([])
  // 筛选区默认收起；展开状态按调用点记忆（同一处再次打开保持上次状态）。
  const [filtersOpen, setFiltersOpen] = useState(() => readFilterPanelState(pickerId))

  const built = useMemo(
    () => buildModelPickerOptions(models, providers, constraints, labels),
    [constraints, labels, models, providers]
  )
  const selection = useMemo(
    () => resolveModelPickerSelection(value, built.options, providers, labels),
    [built.options, labels, providers, value]
  )
  const groups = useMemo(
    () => filterModelPickerGroups(built.groups, { query, categories, protocols }),
    [built.groups, categories, protocols, query]
  )
  const visibleOptions = groups.flatMap((group) => group.options)
  const notice = selection !== null && (selection.outsideCandidates || selection.providerDisabled)
    ? selectionNotice(selection, constraints, labels)
    : null

  const logoUrl = selection ? getProviderIconUrl(providerIconKey(selection.providerId)) : undefined
  // 选中模型的可用性结论：直接按 provider + model 计算（选中值可能已不在候选里，不能只查 options）。
  const selectionModel = (() => {
    if (!selection) return undefined
    const modelId = selection.value.slice(selection.value.indexOf(':') + 1)
    return providers.find((entry) => entry.id === selection.providerId)?.models.find((entry) => entry.id === modelId)
  })()
  const selectionProvider = selection
    ? providers.find((entry) => entry.id === selection.providerId)
    : undefined
  const selectionAvailability = selectionProvider && selectionModel
    ? resolveModelAvailabilityView(selectionProvider, selectionModel)
    : undefined
  // tooltip 给出完整标识（模型名 + 厂商名 + `providerId:modelId`），省略号只裁显示。
  const triggerTitle = selection
    ? `${selection.modelName} · ${selection.providerName} · ${selection.value}`
    : undefined

  function toggleCategory(key: ModelPickerCategory): void {
    setCategories((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]
    )
  }

  function toggleProtocol(key: ModelProtocolTab): void {
    setProtocols((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]
    )
  }

  function toggleFilters(): void {
    setFiltersOpen((current) => {
      writeFilterPanelState(pickerId, !current)
      return !current
    })
  }

  function choose(next: ModelPickerOption | undefined): void {
    if (!next) return
    onChange(next.value)
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement={placement}
      overlayClassName="model-picker-popover"
      destroyOnHidden
      content={
        <ModelPickerPanel
          labels={labels}
          built={built}
          groups={groups}
          value={value}
          query={query}
          categories={categories}
          protocols={protocols}
          filtersOpen={filtersOpen}
          notice={notice}
          visibleCount={visibleOptions.length}
          onQueryChange={setQuery}
          onToggleCategory={toggleCategory}
          onToggleProtocol={toggleProtocol}
          onToggleFilters={toggleFilters}
          onClearFilters={() => {
            setCategories([])
            setProtocols([])
          }}
          onChoose={choose}
          onSubmitQuery={() => choose(visibleOptions[0])}
          onClose={() => setOpen(false)}
          onOpenModelService={() => {
            setOpen(false)
            onOpenModelService()
          }}
        />
      }>
      {trigger ?? (
      <button
        type="button"
        className="model-picker-trigger"
        data-model-picker={pickerId}
        data-model-picker-trigger
        data-selected={selection !== null}
        disabled={disabled}
        title={triggerTitle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={triggerTitle ?? placeholder ?? labels.pickerSelectModel}>
        {logoUrl ? <img className="model-picker-trigger-logo" src={logoUrl} alt="" aria-hidden="true" /> : null}
        <span className="model-picker-trigger-name" data-model-picker-name>
          {selection?.modelName ?? placeholder ?? labels.pickerSelectModel}
        </span>
        {/* 选择框后面直接给可用性图标：绿勾 = 可用，红叉 = 不可用，灰圈 = 待检测。 */}
        {selection ? (
          <ModelAvailabilityIcon
            labels={labels}
            view={selectionAvailability}
            pending={selectionModel !== undefined && isAvailabilityProbeModel(selectionModel)}
          />
        ) : null}
        {selection ? (
          <span className="model-picker-trigger-provider" data-model-picker-provider>
            {selection.providerName}
          </span>
        ) : null}
        {allowClear && selection ? (
          <span
            role="button"
            tabIndex={-1}
            className="model-picker-trigger-clear"
            data-model-picker-clear
            aria-label={labels.pickerClearSelection}
            onClick={(event) => {
              event.stopPropagation()
              setOpen(false)
              onClear?.()
            }}>
            <X size={12} aria-hidden="true" />
          </span>
        ) : null}
        <ChevronDown className="model-picker-trigger-chevron" size={13} aria-hidden="true" />
      </button>
      )}
    </Popover>
  )
}

function providerIconKey(providerId: string): string | undefined {
  const visual = resolveProviderVisual(providerId)
  return visual.iconKey ?? visual.key
}

/** 旧值不满足约束时只提示「建议更换」，不改写配置。 */
function selectionNotice(
  selection: ModelPickerSelection,
  constraints: ModelPickerConstraints | undefined,
  labels: PlatformText['models']
): string {
  if (selection.providerDisabled) return labels.pickerProviderDisabledHint(selection.modelName)
  if (constraints?.requireCapabilities?.includes('imageGeneration')) return labels.pickerImageHint(selection.modelName)
  if (constraints?.protocols?.includes('messages')) return labels.pickerMessagesHint(selection.modelName)
  return labels.pickerConstraintHint(selection.modelName)
}

/** 筛选区展开状态：本次会话内按调用点记忆（不落盘、不跨调用点）。 */
const filterPanelState = new Map<string, boolean>()

function filterPanelKey(pickerId: string | undefined): string {
  return pickerId ?? 'default'
}

function readFilterPanelState(pickerId: string | undefined): boolean {
  return filterPanelState.get(filterPanelKey(pickerId)) ?? false
}

function writeFilterPanelState(pickerId: string | undefined, open: boolean): void {
  filterPanelState.set(filterPanelKey(pickerId), open)
}
