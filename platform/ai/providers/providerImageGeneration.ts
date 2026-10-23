import { classifyHttpFailure, classifyProviderTransportFailure } from './providerFailureMapping'
import { readUpstreamFailureDetails } from './providerFailureBody'
import {
  describeImageTransportFailure,
  redactImageFailureSecrets
} from './providerImageFailure'
import {
  imageEndpointUrl,
  readGeneratedImagePayload,
  MAX_IMAGE_BYTES,
  type GeneratedImage
} from './providerImagePayload'
import { mergeProviderHeaders } from './providerRequestHeaders'
import type { ModelProvider } from './modelProviderTypes'

/**
 * PLAT-63 第二阶段 B：图像生成（`imageEndpoints.generation`）的主进程契约。
 *
 * 只认已配置端点；返回 base64（每张 ≤2MB），失败复用既有分类码与脱敏规则：
 * message 里**绝不**出现 Key、自定义头值、原始 JSON 或 base64；本模块不写任何日志。
 */
export const imageGenerationSizes = ['256x256', '512x512', '1024x1024'] as const
export type ImageGenerationSize = (typeof imageGenerationSizes)[number]

export { MAX_IMAGE_BYTES }
export type { GeneratedImage }
export const MAX_PROMPT_LENGTH = 2000
export const MAX_IMAGE_COUNT = 4

export type ImageGenerationInput = {
  modelId: string
  prompt: string
  size: ImageGenerationSize
  count: number
}

export type ImageGenerationOutcome =
  | { ok: true; images: GeneratedImage[] }
  | { ok: false; reasonCode: string; message: string }

export type ValidatedImageGenerationRequest =
  | { ok: true; value: ImageGenerationInput }
  | { ok: false; reasonCode: 'invalid_request'; message: string }

export function validateImageGenerationInput(input: unknown): ValidatedImageGenerationRequest {
  const value = (input ?? {}) as {
    modelId?: unknown
    prompt?: unknown
    size?: unknown
    count?: unknown
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

  return {
    ok: true,
    value: { modelId, prompt, size: size as ImageGenerationSize, count }
  }
}

function invalid(message: string): ValidatedImageGenerationRequest {
  return { ok: false, reasonCode: 'invalid_request', message }
}

export async function generateProviderImages(
  provider: ModelProvider,
  request: ImageGenerationInput & { fetch: typeof fetch }
): Promise<ImageGenerationOutcome> {
  const baseUrl = provider.imageEndpoints?.generation?.trim() ?? ''
  if (!baseUrl) return failure('missing_endpoint', 'The provider has no image generation endpoint.')
  if (!provider.models.some((model) => model.id === request.modelId)) {
    return failure('model_not_found', 'The requested image model is not configured on this provider.')
  }
  const apiKey = provider.apiKey?.trim() ?? ''

  try {
    const response = await request.fetch(buildImagesUrl(baseUrl), {
      method: 'POST',
      headers: mergeProviderHeaders(
        {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
        },
        provider.customHeaders
      ),
      body: JSON.stringify({
        model: request.modelId,
        prompt: request.prompt,
        n: request.count,
        size: request.size,
        response_format: 'b64_json'
      })
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

export function buildImagesUrl(baseUrl: string): string {
  return imageEndpointUrl(baseUrl, 'generations')
}

function failure(reasonCode: string, message: string): ImageGenerationOutcome {
  return { ok: false, reasonCode, message }
}
