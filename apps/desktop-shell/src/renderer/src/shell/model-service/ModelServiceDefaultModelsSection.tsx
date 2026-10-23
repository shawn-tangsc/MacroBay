import { ChevronDown } from 'lucide-react'
import { useState } from 'react'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import type { ModelDefaultsSettings } from '@platform/settings/schema/appSettings'

import type { PlatformText } from '../../i18n/platformText'
import { ModelPicker } from '../components/ModelPicker/ModelPicker'
import {
  buildDefaultModelCandidates,
  defaultModelConstraints,
  moreDefaultModelFields,
  primaryDefaultModelFields,
  type DefaultModelField
} from './modelServiceDefaultModels'

type ModelServiceDefaultModelsSectionProps = {
  labels: PlatformText['models']
  providers: readonly SafeModelProvider[]
  values: ModelDefaultsSettings
  /** 即时保存（无保存按钮）：与全站设置一致，变更即写回。 */
  onChange: (field: DefaultModelField, value: string) => void
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
  const [expanded, setExpanded] = useState(false)

  const labelOf: Record<DefaultModelField, string> = {
    assistantModelId: labels.defaultModelAssistant,
    agentModelId: labels.defaultModelAgent,
    fastModelId: labels.defaultModelFast,
    translationModelId: labels.defaultModelTranslation,
    imageModelId: labels.defaultModelImage
  }

  function renderRow(field: DefaultModelField): React.ReactElement {
    return (
      <span className="model-service-default-item" data-default-model-row={field} key={field}>
        <span className="model-service-default-item-label">{labelOf[field]}</span>
        <span className="model-service-default-chip" data-default-model-select={field}>
          <ModelPicker
            pickerId={`default-model-${field}`}
            value={values[field] || null}
            onChange={(value) => onChange(field, value)}
            models={buildDefaultModelCandidates(providers, field)}
            providers={providers}
            labels={labels}
            constraints={defaultModelConstraints(field)}
          />
        </span>
      </span>
    )
  }

  return (
    <section className="model-service-default-models" data-model-service-default-models>
      <div className="model-service-default-row" data-default-model-row-group="primary">
        <div className="model-service-default-row-scroll">{primaryDefaultModelFields.map(renderRow)}</div>
        <button
          type="button"
          className="model-service-default-toggle"
          data-default-models-toggle
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}>
          <span>{expanded ? labels.defaultModelsCollapse : labels.defaultModelsShowMore}</span>
          <ChevronDown className="model-service-default-toggle-chevron" size={13} aria-hidden="true" />
        </button>
      </div>
      {expanded ? (
        <div className="model-service-default-row" data-default-model-row-group="more">
          <div className="model-service-default-row-scroll">{moreDefaultModelFields.map(renderRow)}</div>
        </div>
      ) : null}
    </section>
  )
}
