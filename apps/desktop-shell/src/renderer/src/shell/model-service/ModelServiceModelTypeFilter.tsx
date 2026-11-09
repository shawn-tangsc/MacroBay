import {
  AudioLines,
  Boxes,
  Eye,
  Image as ImageIcon,
  LayoutGrid,
  ListOrdered,
  Mic,
  ScanText,
  Tag,
  Type,
  Video
} from 'lucide-react'

import type { ModelDefinition } from '@platform/ai/providers/modelProviderTypes'
import { resolveModelPriceTag } from '@platform/ai/providers/modelPriceTag'

import { Segmented } from '@platform/ui/components/segmented'

import type { PlatformText } from '../../i18n/platformText'
import { resolveModelCapabilities } from '@platform/ai/providers/modelCapabilityInference'

/** PLAT-62：模型类型 pill（图标 + 文案 + 计数）。 */
export type ModelTypeTab =
  | 'all'
  | 'deal'
  | 'text'
  | 'rerank'
  | 'embedding'
  | 'image'
  | 'video'
  | 'speech'
  | 'transcription'
  | 'ocr'
  | 'vision'

/**
 * PLAT-76/81：顺序：媒体/专长族优先（重排 > 嵌入 > 图像 > 视频 > 语音 > 转录 > OCR），最后视觉。
 *
 * PM 口径：「智能体」不是模型类型（它由**协议**表达：Anthropic Messages / Responses / Gemini 原生），
 * 所以这里 11 个 pill（全部 + 免费&折扣 + 9 个模型类型），协议筛选在第二行（见 `ModelServiceProtocolFilter`）。
 */
/**
 * 文案键前缀：这组标签的文案都落在 `platformText.models` 这一层。
 *
 * 键必须是**能解析到的真实路径**（契约 §7：`Tabs` / `Segmented` 的 `labelKey` 是开区间字符串，
 * 形状由守卫保证）。写短名 `typeVision` 读者看不出它属于哪一层，守卫也判它「不是键」。
 */
const TEXT_KEY_PREFIX = 'models.'

type ModelTypeLabelKey = `models.${keyof PlatformText['models']}`

const TABS: Array<{ key: ModelTypeTab; labelKey: ModelTypeLabelKey; Icon: typeof LayoutGrid }> = [
  { key: 'all', labelKey: 'models.typeAll', Icon: LayoutGrid },
  // 价格不是模型类型，但放在「全部」后面更顺手：先筛掉全价付费，再看类型。
  { key: 'deal', labelKey: 'models.typeDeal', Icon: Tag },
  { key: 'text', labelKey: 'models.typeText', Icon: Type },
  { key: 'rerank', labelKey: 'models.typeRerank', Icon: ListOrdered },
  { key: 'embedding', labelKey: 'models.typeEmbedding', Icon: Boxes },
  { key: 'image', labelKey: 'models.typeImage', Icon: ImageIcon },
  { key: 'video', labelKey: 'models.typeVideo', Icon: Video },
  { key: 'speech', labelKey: 'models.typeSpeech', Icon: AudioLines },
  { key: 'transcription', labelKey: 'models.typeTranscription', Icon: Mic },
  { key: 'ocr', labelKey: 'models.typeOcr', Icon: ScanText },
  { key: 'vision', labelKey: 'models.typeVision', Icon: Eye }
]

/** 把真实文案路径还原成 `PlatformText['models']` 的字段名；不是本层路径就不认。 */
function toModelTextField(key: string): keyof PlatformText['models'] | undefined {
  if (!key.startsWith(TEXT_KEY_PREFIX)) return undefined
  return key.slice(TEXT_KEY_PREFIX.length) as keyof PlatformText['models']
}

export function buildModelTypeCounts(
  models: readonly ModelDefinition[]
): Record<ModelTypeTab, number> {
  const resolved = models.map((model) => resolveModelCapabilities(model))
  return {
    all: models.length,
    deal: models.filter((model) => resolveModelPriceTag(model) !== 'paid').length,
    text: resolved.filter((capabilities) => capabilities.chat).length,
    image: resolved.filter((capabilities) => capabilities.imageGeneration).length,
    embedding: resolved.filter((capabilities) => capabilities.embedding).length,
    rerank: resolved.filter((capabilities) => capabilities.rerank).length,
    speech: resolved.filter((capabilities) => capabilities.speech).length,
    transcription: resolved.filter((capabilities) => capabilities.transcription).length,
    ocr: resolved.filter((capabilities) => capabilities.ocr).length,
    video: resolved.filter((capabilities) => capabilities.videoGeneration).length,
    vision: resolved.filter((capabilities) => capabilities.vision).length
  }
}

export function matchesModelType(model: ModelDefinition, tab: ModelTypeTab): boolean {
  if (tab === 'deal') return resolveModelPriceTag(model) !== 'paid'
  const capabilities = resolveModelCapabilities(model)
  if (tab === 'text') return capabilities.chat
  if (tab === 'image') return Boolean(capabilities.imageGeneration)
  if (tab === 'embedding') return Boolean(capabilities.embedding)
  if (tab === 'rerank') return Boolean(capabilities.rerank)
  if (tab === 'speech') return Boolean(capabilities.speech)
  if (tab === 'transcription') return Boolean(capabilities.transcription)
  if (tab === 'ocr') return Boolean(capabilities.ocr)
  if (tab === 'video') return Boolean(capabilities.videoGeneration)
  if (tab === 'vision') return Boolean(capabilities.vision)
  return true
}

/** 这组按钮的可访问名（键）；`Segmented` 只收键，句子由下面这个解析器给。 */
const GROUP_ARIA_KEY: ModelTypeLabelKey = 'models.typeFilterLabel'

/**
 * 模型类型筛选 → 平台 `Segmented`（界面 2026-11-09 判：这是**筛选**不是分页，不给 `Tabs`）。
 *
 * 语义由组件承担：`role="group"` + 每项 `aria-pressed`；左右只移动焦点、Enter/Space 才选中。
 * 计数仍然可见——拼进标签文字里（数字由调用方格式化，组件不二次格式化），信息不因为换组件而丢。
 */
export function ModelServiceModelTypeFilter({
  labels,
  active,
  counts,
  onChange
}: {
  labels: PlatformText['models']
  active: ModelTypeTab
  counts: Record<ModelTypeTab, number>
  onChange: (tab: ModelTypeTab) => void
}): React.ReactElement {
  const resolveText = (key: string): string => {
    const field = toModelTextField(key)
    if (field === undefined) return ''
    if (field === 'typeFilterLabel') return labels.typeFilterLabel
    const tab = TABS.find((candidate) => candidate.labelKey === key)
    return tab === undefined ? '' : `${labels[field]} ${counts[tab.key]}`
  }
  return (
    <div data-model-type-filter>
      <Segmented
        ariaLabelKey={GROUP_ARIA_KEY}
        items={TABS.map(({ key, labelKey, Icon }) => ({ value: key, labelKey, icon: Icon }))}
        onChange={(value) => onChange(value as ModelTypeTab)}
        resolveText={resolveText}
        value={active}
      />
    </div>
  )
}
