import type { ModelDefinition, SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import type { ModelDefaultsSettings } from '@platform/settings/schema/appSettings'

import type { PlatformText } from '../../i18n/platformText'
import { ModelPicker } from '../components/ModelPicker/ModelPicker'
import {
  buildDefaultModelCandidates,
  defaultModelConstraints,
  primaryDefaultModelFields,
  type DefaultModelField
} from './modelServiceDefaultModels'
import { useModelAvailabilityCheck } from './useModelAvailabilityCheck'

type ModelServiceDefaultModelsSectionProps = {
  labels: PlatformText['models']
  providers: readonly SafeModelProvider[]
  values: ModelDefaultsSettings
  /** 即时保存（无保存按钮）：与全站设置一致，变更即写回。 */
  onChange: (field: DefaultModelField, value: string) => void
}

/**
 * 单个默认模型选择器：选择框后面直接带可用性图标。
 *
 * 只对**这个选择器选中的那一个模型**做联通性探测（没有新鲜结论时才发请求）；
 * 不遍历供应商模型列表，也不因为别的选择器而批量探测。
 */
function DefaultModelFieldRow({
  field,
  label,
  value,
  providers,
  labels,
  onChange
}: {
  field: DefaultModelField
  label: string
  value: string
  providers: readonly SafeModelProvider[]
  labels: PlatformText['models']
  onChange: (field: DefaultModelField, value: string) => void
}): React.ReactElement {
  const selected = splitDefaultModelValue(value)
  const provider = selected ? providers.find((entry) => entry.id === selected.providerId) : undefined
  const model: ModelDefinition | undefined = selected
    ? provider?.models.find((entry) => entry.id === selected.modelId)
    : undefined
  // 只测这一个：有新鲜结论就不发请求，见 `useModelAvailabilityCheck`。
  useModelAvailabilityCheck({ provider, model })

  return (
    <span className="model-service-default-item" data-default-model-row={field}>
      <span className="model-service-default-item-label">{label}</span>
      <span className="model-service-default-chip" data-default-model-select={field}>
        <ModelPicker
          pickerId={`default-model-${field}`}
          value={value || null}
          onChange={(next) => onChange(field, next)}
          models={buildDefaultModelCandidates(providers, field, labels.providerNames)}
          providers={providers}
          labels={labels}
          constraints={defaultModelConstraints(field)}
        />
      </span>
    </span>
  )
}

function splitDefaultModelValue(value: string): { providerId: string; modelId: string } | null {
  const trimmed = value.trim()
  const index = trimmed.indexOf(':')
  if (index <= 0 || index === trimmed.length - 1) return null
  return { providerId: trimmed.slice(0, index), modelId: trimmed.slice(index + 1) }
}

/**
 * PLAT-80：模型服务页**置顶**的「默认模型」区块。
 *
 * 布局分两行（分组见 `modelServiceDefaultModels`）：第一行是 4 个常用的文本默认模型，
 * 第二行是绘画模型，**默认收起**，点行尾「更多默认模型设置」展开，避免默认模型条超出可视区域。
 *
 * 选择器统一用 `ModelPicker`；候选与约束来自 `modelServiceDefaultModels`（唯一事实），
 * 组件里不为任何字段写 if。
 */
export function ModelServiceDefaultModelsSection({
  labels,
  providers,
  values,
  onChange
}: ModelServiceDefaultModelsSectionProps): React.ReactElement {
  // 只有 `primaryDefaultModelFields` 里的字段会渲染；`imageModelId`（绘画模型）没有任何控件（C10），
  // 连它的标签也不留在表里——留一个用不到的键，下一个人会以为那一行只是暂时藏起来了。
  type RenderedField = (typeof primaryDefaultModelFields)[number]
  const labelOf: Record<RenderedField, string> = {
    assistantModelId: labels.defaultModelAssistant,
    agentModelId: labels.defaultModelAgent,
    fastModelId: labels.defaultModelFast,
    translationModelId: labels.defaultModelTranslation
  }

  function renderRow(field: RenderedField): React.ReactElement {
    return (
      <DefaultModelFieldRow
        key={field}
        field={field}
        label={labelOf[field]}
        value={values[field] || ''}
        providers={providers}
        labels={labels}
        onChange={onChange}
      />
    )
  }

  return (
    <section className="model-service-default-models" data-model-service-default-models>
      <div className="model-service-default-row" data-default-model-row-group="primary">
        <div className="model-service-default-row-scroll">{primaryDefaultModelFields.map(renderRow)}</div>
      </div>
    </section>
  )
}
