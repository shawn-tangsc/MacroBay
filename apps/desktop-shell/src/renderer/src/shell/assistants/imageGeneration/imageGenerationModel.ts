import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import type { ImageGenerationSize } from '@platform/ai/providers/providerImageGeneration'
import {
  MAX_SOURCE_IMAGE_BYTES,
  normalizeImageEditSourceMime
} from '@platform/ai/providers/imageEditLimits'

export type { ImageGenerationSize } from '@platform/ai/providers/providerImageGeneration'

import type { PlatformText } from '../../../i18n/platformText'
import {
  formatProviderRuntimeCheckReason,
  type ProviderRuntimeCheckReasonLabels
} from '../../providerRuntimeCheckReason'

/**
 * T1–T3：图像生成 / 编辑的渲染层纯逻辑。
 *
 * 结果不再是 base64：消息里是 `{kind:'image', mime, fileName, byteLength}` 引用，
 * 渲染层用 `buildGeneratedImageUrl(fileName)` 得到 `app-image://` 地址。
 * 生成目标要求配 `imageEndpoints.generation`，编辑目标要求配 `imageEndpoints.edit`；
 * 失败文案优先用图像专属人话，其余复用连接检查/模型服务共用的 reason 文案。
 */
export type ImageTarget = {
  providerId: string
  providerName: string
  modelId: string
}

export type ImageGenerationDraft = {
  prompt: string
  size: ImageGenerationSize
  count: number
}

/** 原图：会话里已生成的图片给文件名；本次上传给字节（主进程负责落盘）。 */
export type ImageEditSource = { fileName: string } | { mime: string; bytes: Uint8Array }

export type ImageEditDraft = {
  prompt: string
  size: ImageGenerationSize
  source: ImageEditSource
}

/** 只存在一次生成/编辑期间的本地占位（真正的消息由主进程落库）。 */
export type PendingImageEntry = {
  id: string
  createdAt: number
  kind: 'generate' | 'edit'
  prompt: string
}

export type AssistantImageGenerationView = {
  target: ImageTarget | null
  editTarget: ImageTarget | null
  isGenerating: boolean
  errorText: string | null
  /** 返回 true = 已派发到主进程；false = 本地校验拒绝（面板保留并显示 errorText）。 */
  onGenerate: (draft: ImageGenerationDraft) => Promise<boolean>
  onEdit: (draft: ImageEditDraft) => Promise<boolean>
}

export type ImageGenerationValidationError = 'prompt_required' | 'count_invalid' | 'size_invalid'
export type ImageEditValidationError =
  | 'prompt_required'
  | 'size_invalid'
  | 'source_required'
  | 'source_too_large'
  | 'source_type_unsupported'

export type ImageGenerationFailureLabels = {
  image: Pick<
    PlatformText['assistants'],
    | 'imageFailureTooLarge'
    | 'imageFailureNoEndpoint'
    | 'imageFailureInvalidRequest'
    | 'imageFailureModelNotFound'
    | 'imageFailureInvalidResponse'
    | 'imageFailureSourceTooLarge'
    | 'imageFailureSourceTypeUnsupported'
    | 'imageFailureSourceMissing'
    | 'imageFailureTopicMissing'
  >
  reason: ProviderRuntimeCheckReasonLabels
}

export const imageGenerationSizeOptions: readonly ImageGenerationSize[] = ['256x256', '512x512', '1024x1024']
export const defaultImageGenerationSize: ImageGenerationSize = '1024x1024'
export const maxImageGenerationCount = 4
export const maxImagePromptLength = 2000
export const maxSourceImageBytes = MAX_SOURCE_IMAGE_BYTES

/** 第一个配置了该端点且有可用模型的供应商；否则 null（入口据此禁用）。 */
export function resolveImageTarget(
  providers: readonly SafeModelProvider[],
  endpoint: 'generation' | 'edit'
): ImageTarget | null {
  for (const provider of providers) {
    if (!provider.imageEndpoints?.[endpoint]?.trim()) continue
    if (provider.models.length === 0) continue
    const model =
      provider.models.find((entry) => entry.capabilities.imageGeneration === true) ??
      provider.models.find((entry) => entry.id === provider.defaultChatModelId) ??
      provider.models[0]
    if (!model) continue
    return { providerId: provider.id, providerName: provider.name, modelId: model.id }
  }
  return null
}

export function resolveImageGenerationTarget(providers: readonly SafeModelProvider[]): ImageTarget | null {
  return resolveImageTarget(providers, 'generation')
}

export function resolveImageEditTarget(providers: readonly SafeModelProvider[]): ImageTarget | null {
  return resolveImageTarget(providers, 'edit')
}

export function validateImageGenerationDraft(draft: {
  prompt: string
  count: number
  size: string
}): ImageGenerationValidationError | null {
  if (!draft.prompt.trim() || draft.prompt.length > maxImagePromptLength) return 'prompt_required'
  if (!Number.isInteger(draft.count) || draft.count < 1 || draft.count > maxImageGenerationCount) {
    return 'count_invalid'
  }
  if (!(imageGenerationSizeOptions as readonly string[]).includes(draft.size)) return 'size_invalid'
  return null
}

export function validateImageEditDraft(draft: { prompt: string; size: string; source?: ImageEditSource | null }): ImageEditValidationError | null {
  if (!draft.source) return 'source_required'
  if (!draft.prompt.trim() || draft.prompt.length > maxImagePromptLength) return 'prompt_required'
  if (!(imageGenerationSizeOptions as readonly string[]).includes(draft.size)) return 'size_invalid'
  if ('mime' in draft.source) {
    if (!normalizeImageEditSourceMime(draft.source.mime)) return 'source_type_unsupported'
    if (draft.source.bytes.byteLength > maxSourceImageBytes) return 'source_too_large'
  }
  return null
}

/** 上传前的本地体检（File 的 size/type）；主进程仍会再校验一遍。 */
export function validateImageEditSourceFile(file: { size: number; type: string }): ImageEditValidationError | null {
  if (!normalizeImageEditSourceMime(file.type)) return 'source_type_unsupported'
  if (file.size <= 0) return 'source_required'
  if (file.size > maxSourceImageBytes) return 'source_too_large'
  return null
}

/** 下载文件名从生成时间 + 引用里的扩展名来（磁盘文件名是 hash，不直接给用户看）。 */
export function buildGeneratedImageFileName(createdAt: number, fileName: string, index = 0): string {
  const extension = fileName.slice(fileName.lastIndexOf('.') + 1) || 'png'
  const suffix = index > 0 ? `-${index + 1}` : ''
  return `generated-${createdAt}${suffix}.${extension === 'jpg' ? 'jpg' : extension}`
}

export function describeImageGenerationFailure(
  reasonCode: string | null,
  labels: ImageGenerationFailureLabels
): string {
  switch (reasonCode) {
    case 'image_too_large':
      return labels.image.imageFailureTooLarge
    case 'missing_endpoint':
      return labels.image.imageFailureNoEndpoint
    case 'invalid_request':
      return labels.image.imageFailureInvalidRequest
    case 'model_not_found':
      return labels.image.imageFailureModelNotFound
    case 'invalid_response':
      return labels.image.imageFailureInvalidResponse
    case 'source_image_too_large':
      return labels.image.imageFailureSourceTooLarge
    case 'source_image_type_unsupported':
      return labels.image.imageFailureSourceTypeUnsupported
    case 'source_image_missing':
      return labels.image.imageFailureSourceMissing
    case 'missing_topic':
      return labels.image.imageFailureTopicMissing
    default:
      return formatProviderRuntimeCheckReason(
        (reasonCode ?? 'unknown') as Parameters<typeof formatProviderRuntimeCheckReason>[0],
        labels.reason
      ) ?? labels.reason.connectionCheckReasonUnknown
  }
}

export function describeImageEditValidationError(
  error: ImageEditValidationError,
  labels: PlatformText['assistants']
): string {
  if (error === 'source_required') return labels.imageEditSourceRequired
  if (error === 'source_too_large') return labels.imageFailureSourceTooLarge
  if (error === 'source_type_unsupported') return labels.imageFailureSourceTypeUnsupported
  if (error === 'size_invalid') return labels.imageFailureInvalidSize
  return labels.imagePromptRequired
}
