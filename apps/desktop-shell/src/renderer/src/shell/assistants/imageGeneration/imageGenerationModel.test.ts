import { describe, expect, it } from 'vitest'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import { platformText } from '../../../i18n/platformText'
import {
  buildGeneratedImageFileName,
  describeImageEditValidationError,
  describeImageGenerationFailure,
  maxSourceImageBytes,
  resolveImageEditTarget,
  resolveImageGenerationTarget,
  validateImageEditDraft,
  validateImageEditSourceFile,
  validateImageGenerationDraft
} from './imageGenerationModel'

/**
 * T1–T3：图像生成/编辑的渲染层纯逻辑（选目标 / 校验 / 人话文案 / 下载文件名）。
 * 结果引用来自主进程（fileName），这里不再有任何 base64 → data URL 的转换。
 */
const labels = platformText['en-US'].assistants
const models = platformText['en-US'].models
const failureLabels = { image: labels, reason: models }

function provider(overrides: Partial<SafeModelProvider> & { id: string }): SafeModelProvider {
  return {
    name: overrides.id,
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://api.test' }
    ],
    enabled: true,
    baseUrl: 'https://api.test',
    hasApiKey: true,
    apiKeyPreview: 'sk-**********1234',
    models: [{ id: `${overrides.id}-chat`, name: 'Chat', capabilities: { chat: true } }],
    ...overrides
  } as SafeModelProvider
}

const imageProvider = provider({
  id: 'images',
  name: 'Images',
  imageEndpoints: {
    generation: 'https://api.test/images',
    edit: 'https://api.test/images'
  },
  models: [
    { id: 'images-chat', name: 'Chat', capabilities: { chat: true } },
    { id: 'images-model', name: 'Image', capabilities: { chat: false, imageGeneration: true } }
  ]
})

describe('resolveImageGenerationTarget / resolveImageEditTarget', () => {
  it('picks the first provider that configured the matching endpoint', () => {
    expect(
      resolveImageGenerationTarget([
        provider({ id: 'plain' }),
        provider({ id: 'gen-only', imageEndpoints: { generation: 'https://api.test/images' } })
      ])
    ).toEqual({ providerId: 'gen-only', providerName: 'gen-only', modelId: 'gen-only-chat' })

    expect(resolveImageEditTarget([provider({ id: 'plain' }), imageProvider])).toEqual({
      providerId: 'images',
      providerName: 'Images',
      modelId: 'images-model'
    })
  })

  it('does not let one endpoint enable the other', () => {
    expect(
      resolveImageEditTarget([provider({ id: 'gen-only', imageEndpoints: { generation: 'https://api.test/i' } })])
    ).toBeNull()
    expect(
      resolveImageGenerationTarget([provider({ id: 'edit-only', imageEndpoints: { edit: 'https://api.test/i' } })])
    ).toBeNull()
  })

  it('prefers the image-capable model and skips blank endpoints or empty model lists', () => {
    expect(resolveImageGenerationTarget([imageProvider])?.modelId).toBe('images-model')
    expect(
      resolveImageGenerationTarget([provider({ id: 'blank', imageEndpoints: { generation: '  ' } })])
    ).toBeNull()
    expect(
      resolveImageGenerationTarget([
        provider({ id: 'model-less', imageEndpoints: { generation: 'https://api.test/i' }, models: [] })
      ])
    ).toBeNull()
  })
})

describe('validateImageGenerationDraft', () => {
  it('accepts a normal draft', () => {
    expect(validateImageGenerationDraft({ prompt: 'a red fox', count: 2, size: '512x512' })).toBeNull()
  })

  it('rejects an empty/over-long prompt, a bad count and an unknown size', () => {
    expect(validateImageGenerationDraft({ prompt: '  ', count: 1, size: '512x512' })).toBe('prompt_required')
    expect(validateImageGenerationDraft({ prompt: 'x'.repeat(2001), count: 1, size: '512x512' })).toBe(
      'prompt_required'
    )
    expect(validateImageGenerationDraft({ prompt: 'fox', count: 99, size: '512x512' })).toBe('count_invalid')
    expect(validateImageGenerationDraft({ prompt: 'fox', count: 1, size: '4096x4096' })).toBe('size_invalid')
  })
})

describe('validateImageEditDraft', () => {
  it('requires a source image, a prompt and a whitelisted size', () => {
    expect(validateImageEditDraft({ prompt: 'blue', size: '512x512', source: null })).toBe('source_required')
    expect(
      validateImageEditDraft({ prompt: '  ', size: '512x512', source: { fileName: '0123456789abcdef.png' } })
    ).toBe('prompt_required')
    expect(
      validateImageEditDraft({ prompt: 'blue', size: '1x1', source: { fileName: '0123456789abcdef.png' } })
    ).toBe('size_invalid')
  })

  it('checks an uploaded source against the mime whitelist and the 4MB limit', () => {
    expect(
      validateImageEditDraft({
        prompt: 'blue',
        size: '512x512',
        source: { mime: 'image/gif', bytes: new Uint8Array(4) }
      })
    ).toBe('source_type_unsupported')
    expect(
      validateImageEditDraft({
        prompt: 'blue',
        size: '512x512',
        source: { mime: 'image/png', bytes: new Uint8Array(maxSourceImageBytes + 1) }
      })
    ).toBe('source_too_large')
    expect(
      validateImageEditDraft({
        prompt: 'blue',
        size: '512x512',
        source: { mime: 'image/webp', bytes: new Uint8Array(4) }
      })
    ).toBeNull()
  })
})

describe('validateImageEditSourceFile', () => {
  it('accepts png/jpeg/webp within 4MB and explains the rejects', () => {
    expect(validateImageEditSourceFile({ size: 1024, type: 'image/png' })).toBeNull()
    expect(validateImageEditSourceFile({ size: 1024, type: 'image/jpg' })).toBeNull()
    expect(validateImageEditSourceFile({ size: 1024, type: 'image/webp' })).toBeNull()
    expect(validateImageEditSourceFile({ size: 1024, type: 'image/gif' })).toBe('source_type_unsupported')
    expect(validateImageEditSourceFile({ size: maxSourceImageBytes + 1, type: 'image/png' })).toBe(
      'source_too_large'
    )
    expect(validateImageEditSourceFile({ size: 0, type: 'image/png' })).toBe('source_required')
  })

  it('maps every validation error to a human sentence', () => {
    expect(describeImageEditValidationError('source_required', labels)).toBe(labels.imageEditSourceRequired)
    expect(describeImageEditValidationError('source_too_large', labels)).toBe(labels.imageFailureSourceTooLarge)
    expect(describeImageEditValidationError('source_type_unsupported', labels)).toBe(
      labels.imageFailureSourceTypeUnsupported
    )
    expect(describeImageEditValidationError('prompt_required', labels)).toBe(labels.imagePromptRequired)
    expect(describeImageEditValidationError('size_invalid', labels)).toBe(labels.imageFailureInvalidSize)
  })
})

describe('buildGeneratedImageFileName', () => {
  it('names the downloaded file from the timestamp and the referenced extension', () => {
    expect(buildGeneratedImageFileName(1_700_000_000_000, '0123456789abcdef.png')).toBe(
      'generated-1700000000000.png'
    )
    expect(buildGeneratedImageFileName(1_700_000_000_000, '0123456789abcdef.webp', 1)).toBe(
      'generated-1700000000000-2.webp'
    )
    expect(buildGeneratedImageFileName(1_700_000_000_000, '0123456789abcdef.jpg')).toBe(
      'generated-1700000000000.jpg'
    )
  })
})

describe('describeImageGenerationFailure', () => {
  it('uses dedicated sentences for image-only failures', () => {
    expect(describeImageGenerationFailure('image_too_large', failureLabels)).toBe(labels.imageFailureTooLarge)
    expect(describeImageGenerationFailure('missing_endpoint', failureLabels)).toBe(labels.imageFailureNoEndpoint)
    expect(describeImageGenerationFailure('invalid_response', failureLabels)).toBe(
      labels.imageFailureInvalidResponse
    )
    expect(describeImageGenerationFailure('invalid_request', failureLabels)).toBe(labels.imageFailureInvalidRequest)
    expect(describeImageGenerationFailure('model_not_found', failureLabels)).toBe(labels.imageFailureModelNotFound)
    expect(describeImageGenerationFailure('source_image_too_large', failureLabels)).toBe(
      labels.imageFailureSourceTooLarge
    )
    expect(describeImageGenerationFailure('source_image_type_unsupported', failureLabels)).toBe(
      labels.imageFailureSourceTypeUnsupported
    )
    expect(describeImageGenerationFailure('source_image_missing', failureLabels)).toBe(
      labels.imageFailureSourceMissing
    )
    expect(describeImageGenerationFailure('missing_topic', failureLabels)).toBe(labels.imageFailureTopicMissing)
  })

  it('reuses the shared reason sentences for HTTP/network codes', () => {
    expect(describeImageGenerationFailure('http_401', failureLabels)).toBe(models.connectionCheckReasonUnauthorized)
    expect(describeImageGenerationFailure('account_balance_insufficient', failureLabels)).toBe(
      models.connectionCheckReasonAccountBalance
    )
    expect(describeImageGenerationFailure('network_dns', failureLabels)).toBe(models.connectionCheckReasonDns)
    expect(describeImageGenerationFailure('rate_limited', failureLabels)).toBe(
      models.connectionCheckReasonRateLimited
    )
  })

  it('falls back to the unknown sentence', () => {
    expect(describeImageGenerationFailure(null, failureLabels)).toBe(models.connectionCheckReasonUnknown)
    expect(describeImageGenerationFailure('something_new', failureLabels)).toBe(
      models.connectionCheckReasonUnknown
    )
  })
})
