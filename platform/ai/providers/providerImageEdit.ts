import { classifyHttpFailure, classifyProviderTransportFailure } from './providerFailureMapping'
import { readUpstreamFailureDetails } from './providerFailureBody'
import { describeImageTransportFailure, redactImageFailureSecrets } from './providerImageFailure'
import { imageEndpointUrl, readGeneratedImagePayload, type GeneratedImage } from './providerImagePayload'
import {
  imageGenerationSizes,
  MAX_IMAGE_COUNT,
  MAX_PROMPT_LENGTH,
  type ImageGenerationSize
} from './providerImageGeneration'
import {
  imageEditSourceMimeTypes,
  MAX_SOURCE_IMAGE_BYTES,
  normalizeImageEditSourceMime,
  type ImageEditSourceMime
} from './imageEditLimits'
import { mergeProviderHeaders } from './providerRequestHeaders'
import type { ModelProvider } from './modelProviderTypes'

/**
 * T3：图像编辑（`imageEndpoints.edit`）的主进程契约。
 * `POST {imageBase}/v1/images/edits`，`multipart/form-data`：image(Blob) + prompt + model + n + size。
 * 校验：源图 ≤4MB 且只允许 png/jpeg/webp；prompt ≤2000；结果沿用 ≤2MB。
 * 失败复用既有分类码与脱敏（message 里绝不出现 Key / 自定义头值 / 原始 JSON / base64）。
 */
export { MAX_SOURCE_IMAGE_BYTES, imageEditSourceMimeTypes, type ImageEditSourceMime }

/** 渲染层传过来的「原图」：要么是已落盘的文件名，要么是一次上传的字节。 */
export type ImageEditSourceDescriptor =
  | { kind: 'file'; fileName: string }
  | { kind: 'inline'; mime: string; bytes: Uint8Array }

export type ImageEditRequest = {
  modelId: string
  prompt: string
  size: ImageGenerationSize
  count: number
  source: { mime: ImageEditSourceMime; bytes: Uint8Array }
}

export type ValidatedImageEditInput =
  | {
      ok: true
      value: {
        modelId: string
        prompt: string
        size: ImageGenerationSize
        count: number
        sourceImage: ImageEditSourceDescriptor
      }
    }
  | { ok: false; reasonCode: 'invalid_request' | 'source_image_too_large' | 'source_image_type_unsupported'; message: string }

export type ImageEditOutcome =
  | { ok: true; images: GeneratedImage[] }
  | { ok: false; reasonCode: string; message: string }

export function validateImageEditInput(input: unknown): ValidatedImageEditInput {
  const value = (input ?? {}) as {
    modelId?: unknown
    prompt?: unknown
    size?: unknown
    count?: unknown
    sourceImage?: unknown
  }
  const modelId = typeof value.modelId === 'string' ? value.modelId.trim() : ''
  if (!modelId) return invalid('A model id is required.')

  const prompt = typeof value.prompt === 'string' ? value.prompt : ''
  if (!prompt.trim()) return invalid('A prompt is required.')
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return invalid(`The prompt must be at most ${MAX_PROMPT_LENGTH} characters.`)
  }

  const count = value.count === undefined ? 1 : value.count
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_IMAGE_COUNT) {
    return invalid(`The image count must be an integer between 1 and ${MAX_IMAGE_COUNT}.`)
  }

  const size = value.size === undefined ? '1024x1024' : value.size
  if (typeof size !== 'string' || !(imageGenerationSizes as readonly string[]).includes(size)) {
    return invalid(`The image size must be one of ${imageGenerationSizes.join(', ')}.`)
  }

  const sourceImage = readSourceDescriptor(value.sourceImage)
  if (!sourceImage.ok) return sourceImage

  return {
    ok: true,
    value: { modelId, prompt, size: size as ImageGenerationSize, count, sourceImage: sourceImage.value }
  }
}

/** 源图白名单 + 4MB 上限（上传字节与盘上文件读出的字节都走这里）。 */
export function validateEditSourceImage(source: {
  mime: string
  bytes: Uint8Array
}): { ok: true; mime: ImageEditSourceMime } | { ok: false; reasonCode: 'source_image_too_large' | 'source_image_type_unsupported'; message: string } {
  const mime = normalizeImageEditSourceMime(source.mime)
  if (!mime) {
    return {
      ok: false,
      reasonCode: 'source_image_type_unsupported',
      message: 'The source image must be a PNG, JPEG, or WebP file.'
    }
  }
  if (source.bytes.byteLength > MAX_SOURCE_IMAGE_BYTES) {
    return {
      ok: false,
      reasonCode: 'source_image_too_large',
      message: 'The source image exceeds the 4 MB limit.'
    }
  }
  return { ok: true, mime }
}

export function buildImageEditUrl(baseUrl: string): string {
  return imageEndpointUrl(baseUrl, 'edits')
}

export async function editProviderImages(
  provider: ModelProvider,
  request: ImageEditRequest & { fetch: typeof fetch }
): Promise<ImageEditOutcome> {
  const baseUrl = provider.imageEndpoints?.edit?.trim() ?? ''
  if (!baseUrl) return failure('missing_endpoint', 'The provider has no image edit endpoint.')
  if (!provider.models.some((model) => model.id === request.modelId)) {
    return failure('model_not_found', 'The requested image model is not configured on this provider.')
  }
  const source = validateEditSourceImage(request.source)
  if (!source.ok) return failure(source.reasonCode, source.message)
  const apiKey = provider.apiKey?.trim() ?? ''

  try {
    const response = await request.fetch(buildImageEditUrl(baseUrl), {
      method: 'POST',
      // 不手写 content-type：multipart 的 boundary 必须由 fetch 生成。
      headers: mergeProviderHeaders(
        apiKey ? { authorization: `Bearer ${apiKey}` } : {},
        provider.customHeaders
      ),
      body: buildImageEditForm({ ...request, source: { ...request.source, mime: source.mime } })
    })

    if (!response.ok) {
      const upstream = await readUpstreamFailureDetails(response, apiKey)
      const detail = upstream.message === null ? `HTTP ${response.status}` : `HTTP ${response.status} · ${upstream.message}`
      return failure(
        classifyHttpFailure(response.status, upstream.message, upstream.hints),
        redactImageFailureSecrets(detail, provider)
      )
    }

    return readGeneratedImagePayload(await response.json().catch(() => null), request.count)
  } catch (error) {
    return failure(
      classifyProviderTransportFailure(error) ?? 'network_error',
      redactImageFailureSecrets(describeImageTransportFailure(error, apiKey), provider)
    )
  }
}

export function buildImageEditForm(request: ImageEditRequest): FormData {
  const form = new FormData()
  form.append(
    'image',
    new Blob([request.source.bytes], { type: request.source.mime }),
    `source.${request.source.mime === 'image/jpeg' ? 'jpg' : request.source.mime.slice('image/'.length)}`
  )
  form.append('prompt', request.prompt)
  form.append('model', request.modelId)
  form.append('n', String(request.count))
  form.append('size', request.size)
  return form
}

function readSourceDescriptor(
  value: unknown
): { ok: true; value: ImageEditSourceDescriptor } | Extract<ValidatedImageEditInput, { ok: false }> {
  if (!value || typeof value !== 'object') return invalid('A source image is required.')
  const record = value as { fileName?: unknown; mime?: unknown; bytes?: unknown }
  if (typeof record.fileName === 'string') {
    // 只接受资源层生成的文件名（hash.png/jpg/webp），否则就是路径注入。
    if (!/^[a-f0-9]{16}\.(?:png|jpg|webp)$/.test(record.fileName)) {
      return invalid('The source image reference is invalid.')
    }
    return { ok: true, value: { kind: 'file', fileName: record.fileName } }
  }
  const bytes = toBytes(record.bytes)
  const mime = typeof record.mime === 'string' ? record.mime : ''
  if (!bytes || !mime.trim()) return invalid('A source image is required.')
  const validated = validateEditSourceImage({ mime, bytes })
  if (!validated.ok) return { ok: false, reasonCode: validated.reasonCode, message: validated.message }
  return { ok: true, value: { kind: 'inline', mime: validated.mime, bytes } }
}

function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'number')) {
    return Uint8Array.from(value as number[])
  }
  return null
}

function invalid(message: string): Extract<ValidatedImageEditInput, { ok: false }> {
  return { ok: false, reasonCode: 'invalid_request', message }
}

function failure(reasonCode: string, message: string): ImageEditOutcome {
  return { ok: false, reasonCode, message }
}
