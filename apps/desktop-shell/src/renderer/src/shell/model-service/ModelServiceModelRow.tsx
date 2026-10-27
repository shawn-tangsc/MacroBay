import {
  AudioLines,
  Boxes,
  Eye,
  FlaskConical,
  Image as ImageIcon,
  Lightbulb,
  ListOrdered,
  Mic,
  Minus,
  ScanText,
  Settings,
  Video,
  Wrench
} from 'lucide-react'
import { Tag } from 'antd'

import type { ModelDetectionResult } from '@platform/ai/providers/modelDetection/types'
import type { ModelDefinition } from '@platform/ai/providers/modelProviderTypes'
import { LoadingSpinner } from '@platform/ui/components/loading'

import type { PlatformText } from '../../i18n/platformText'
import { resolveModelCapabilities } from '@platform/ai/providers/modelCapabilityInference'
import { resolveModelPriceTag } from '@platform/ai/providers/modelPriceTag'
import {
  detectionStatusText,
  detectionStatusTitle,
  failedDeclaredProtocols,
  protocolOutcomeSummary,
  thisRunFailedProtocolReasons
} from './modelDetectionDisplay'
import { modelRowProtocolChips } from './modelProtocolChips'
import { modelProtocolLabel } from './modelProtocolFilter'
import { buildModelCostTitle, formatModelCost } from './modelPricingDisplay'
import { ModelServiceProtocolChip } from './ModelServiceProtocolChip'

import { modelAvailabilityLabel, modelAvailabilityTitle } from './modelAvailabilityDisplay'
import { isAvailabilityProbeModel, type ModelAvailabilityView } from './modelAvailabilityView'
import { resolveModelMessagesSupport } from './modelMessagesSupport'
import type { ModelDetectionModelStatus } from './useModelDetection'

/**
 * 模型行：能力 chip + 可用性结论 + 本会话检测结果。
 *
 * 可用性结论（`availability`）是落库的「上次检测」事实，只在没有本会话结果时显示；
 * 本会话结果优先，因为它是刚发生的证据。厂商声明仍是协议的事实源：
 * 检测只能对本会话做临时标红（`data-model-protocol-failed`），不改声明。
 */
export function ModelServiceModelRow({
  labels,
  providerId,
  model,
  availability,
  detectionStatus,
  detectionResult,
  isRemovingModel,
  testDisabled = false,
  onTestModel = () => undefined,
  onEditModel,
  onRemoveModel
}: {
  labels: PlatformText['models']
  providerId: string
  model: ModelDefinition
  /** 落库的可用性结论（渲染层已判过期）。 */
  availability?: ModelAvailabilityView
  /** PLAT-82：本会话检测状态（只在内存）。 */
  detectionStatus?: ModelDetectionModelStatus
  /** PLAT-82：本会话检测明细（派生行内文案与标红协议）。 */
  detectionResult?: ModelDetectionResult
  isRemovingModel: boolean
  /** 该供应商已有 run 在跑：单测按钮整体禁用，避免叠加请求。 */
  testDisabled?: boolean
  /** 只测这一个模型（与全量检测同一条链路）。 */
  onTestModel?: (modelId: string) => void
  onEditModel: (model: ModelDefinition) => void
  onRemoveModel: (modelId: string) => Promise<boolean>
}): React.ReactElement {
  const messages = resolveModelMessagesSupport(providerId, model)
  const capabilities = resolveModelCapabilities(model)
  const priceTag = resolveModelPriceTag(model)
  const costLabel = formatModelCost(model)
  const costTitle = buildModelCostTitle(labels, model)
  const failedProtocols = failedDeclaredProtocols(model, detectionResult)
  // 本次 run 没通的协议（会话级）：给非标红的 chip 打黄点，解释行尾「协议 x/y」。
  const thisRunFailures = thisRunFailedProtocolReasons(detectionResult)
  // PLAT-82：「支持哪个就画哪个」——协议 chip 排在能力 chip 之前，固定顺序。
  // 集合 = 模型记录里的支持/声明/**实测通过**集合（证据已落库，见 `modelRowProtocolChips`）。
  const protocolChips = modelRowProtocolChips(model)
  const statusText = detectionStatus === undefined
    ? undefined
    : detectionStatusText(labels, detectionStatus, detectionResult)
  // 逐协议明细走 title（行内只放「协议 2/2」，不撑宽这一行）；摘要不落库，刷新即消失。
  const statusTitle = detectionStatus === undefined || detectionResult === undefined
    ? statusText
    : detectionStatusTitle(labels, detectionStatus, detectionResult)
  const protocolSummary = protocolOutcomeSummary(detectionResult)
  const chips: Array<{ key: string; title: string; icon: React.ReactElement }> = []
  // PLAT-76：**媒体/专长族优先**（rerank > embed > image > video > speech > transcription > ocr），
  // 然后才是推理/视觉/工具，和类型筛选 pill 的顺序保持一致。
  if (capabilities.rerank) {
    chips.push({ key: 'rerank', title: labels.capabilityRerankTitle, icon: <ListOrdered size={12} /> })
  }
  if (capabilities.embedding) {
    chips.push({ key: 'embedding', title: labels.capabilityEmbeddingTitle, icon: <Boxes size={12} /> })
  }
  if (capabilities.imageGeneration) {
    chips.push({ key: 'imageGeneration', title: labels.capabilityImageTitle, icon: <ImageIcon size={12} /> })
  }
  if (capabilities.videoGeneration) {
    chips.push({ key: 'videoGeneration', title: labels.capabilityVideoTitle, icon: <Video size={12} /> })
  }
  if (capabilities.speech) {
    chips.push({ key: 'speech', title: labels.capabilitySpeechTitle, icon: <AudioLines size={12} /> })
  }
  if (capabilities.transcription) {
    chips.push({ key: 'transcription', title: labels.capabilityTranscriptionTitle, icon: <Mic size={12} /> })
  }
  if (capabilities.ocr) {
    chips.push({ key: 'ocr', title: labels.capabilityOcrTitle, icon: <ScanText size={12} /> })
  }
  if (capabilities.reasoning) {
    chips.push({ key: 'reasoning', title: labels.capabilityReasoningTitle, icon: <Lightbulb size={12} /> })
  }
  if (capabilities.vision) {
    chips.push({ key: 'vision', title: labels.capabilityVisionTitle, icon: <Eye size={12} /> })
  }
  if (capabilities.tools) {
    chips.push({ key: 'tools', title: labels.capabilityToolsTitle, icon: <Wrench size={12} /> })
  }

  return (
    <div
      className={`model-service-model-row${model.probeReason === 'model_retired' ? ' is-retired' : ''}${failedProtocols.length > 0 ? ' is-protocol-failed' : ''}`}
      data-model-row={model.id}
      data-model-retired={model.probeReason === 'model_retired' ? 'true' : undefined}
      data-model-messages={messages}
      data-model-protocol-failed={failedProtocols.length > 0 ? failedProtocols.join(',') : undefined}
      title={failedProtocols.length > 0
        ? labels.detectionProtocolFailedTitle(failedProtocols.map((protocol) => modelProtocolLabel(labels, protocol)).join(' / '))
        : undefined}>
      <span className="model-service-model-name">{model.name}</span>
      {detectionStatus === undefined && availability !== undefined ? (
        <span
          className="model-service-model-availability"
          data-model-availability={availability.stale ? 'stale' : availability.status}
          title={modelAvailabilityTitle(labels, availability)}>
          {modelAvailabilityLabel(labels, availability)}
        </span>
      ) : null}

      {statusText !== undefined ? (
        <span
          className="model-service-model-detection"
          data-model-detection-status={detectionStatus}
          data-model-protocol-summary={protocolSummary === undefined
            ? undefined
            : `${protocolSummary.passed}/${protocolSummary.total}`}
          title={statusTitle}>
          {statusText}
        </span>
      ) : null}
      {model.probeReason === 'model_retired' ? (
        <span className="model-service-model-retired-tag" data-model-retired-tag>
          {labels.modelRetiredTag}
        </span>
      ) : null}
      {costLabel !== null ? (
        <span className="model-service-model-cost" data-model-cost title={costTitle ?? undefined}>
          {costLabel}
          {priceTag === 'free' ? (
            <span className="model-service-model-free" data-model-free-tag>
              {labels.modelFreeTag}
            </span>
          ) : model.pricing?.hasDiscount ? (
            <span className="model-service-model-discount" data-model-discount>
              {labels.modelDiscountBadge}
            </span>
          ) : null}
        </span>
      ) : priceTag === 'free' ? (
        <span className="model-service-model-free" data-model-free-tag>
          {labels.modelFreeTag}
        </span>
      ) : null}
      {protocolChips.length > 0 ? (
        <span
          className="model-service-protocol-chips"
          data-model-protocol-chips
          style={{
            display: 'flex',
            flex: '0 0 auto',
            alignItems: 'center',
            // 协议是一组紧密相关的事实：组内 2px，和后面的能力 chip 之间靠行内 gap（8px）分开。
            columnGap: 2,
            flexWrap: 'nowrap'
          }}>
          {protocolChips.map((chip) => (
            <ModelServiceProtocolChip
              key={chip.protocol}
              labels={labels}
              protocol={chip.protocol}
              source={chip.source}
              failed={failedProtocols.includes(chip.protocol)}
              thisRunFailure={thisRunFailures.get(chip.protocol)}
            />
          ))}
        </span>
      ) : null}
      <span className="capability-pills" data-model-chips>
        {chips.map((chip) => (
          <Tag
            key={chip.key}
            className={`capability-tag capability-${chip.key}`}
            data-model-chip={chip.key}
            data-model-chip-source={model.providerDeclared === true ? 'provider' : 'inferred'}
            /* PLAT-77：上游声明的能力实心；按模型名推断的描边，并在 title 里说明来源。 */
            bordered={!model.providerDeclared}
            title={model.providerDeclared === true
              ? chip.title
              : `${chip.title} · ${labels.capabilitySourceInferred}`}
            aria-label={chip.title}
            icon={chip.icon}
          />
        ))}
      </span>
      <span className="model-service-model-actions">
        {isAvailabilityProbeModel(model) ? (
          <button
            type="button"
            className="model-service-row-icon"
            data-model-row-test
            title={labels.testModel}
            aria-label={labels.testModel}
            disabled={testDisabled}
            onClick={() => onTestModel(model.id)}>
            {detectionStatus === 'testing' ? <LoadingSpinner size="sm" /> : <FlaskConical size={13} />}
          </button>
        ) : null}
        <button
          type="button"
          className="model-service-row-icon"
          data-model-row-settings
          title={labels.editModel}
          aria-label={labels.editModel}
          onClick={() => onEditModel(model)}>
          <Settings size={13} />
        </button>
        <button
          type="button"
          className="model-service-row-icon model-service-row-remove"
          data-model-row-remove
          title={labels.removeModel}
          aria-label={labels.removeModel}
          disabled={isRemovingModel}
          onClick={() => void onRemoveModel(model.id)}>
          <Minus size={13} />
        </button>
      </span>
    </div>
  )
}
