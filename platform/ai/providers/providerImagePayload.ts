/**
 * 图像端点共用的响应解析（生成 / 编辑都只认 `b64_json`）。
 * 任何异常结构都退化为 `invalid_response`，绝不把原始 JSON 或 base64 抛给上层。
 */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024

export type GeneratedImage = { mime: string; base64: string }

export type GeneratedImagePayloadOutcome =
  | { ok: true; images: GeneratedImage[] }
  | { ok: false; reasonCode: string; message: string }

export function readGeneratedImagePayload(
  payload: unknown,
  requestedCount: number,
  maxBytes: number = MAX_IMAGE_BYTES
): GeneratedImagePayloadOutcome {
  const data = (payload as { data?: unknown } | null)?.data
  if (!Array.isArray(data) || data.length === 0) {
    return failure('invalid_response', 'The image service returned an unrecognized response.')
  }
  const images: GeneratedImage[] = []
  for (const item of data.slice(0, requestedCount)) {
    const record = (item ?? {}) as { b64_json?: unknown; mime_type?: unknown }
    const base64 = typeof record.b64_json === 'string' ? record.b64_json : ''
    if (!base64) return failure('invalid_response', 'The image service returned an unrecognized response.')
    if (imageBase64ByteLength(base64) > maxBytes) {
      return failure('image_too_large', 'The generated image exceeds the 2 MB limit.')
    }
    const mime = typeof record.mime_type === 'string' && record.mime_type.trim() ? record.mime_type : 'image/png'
    images.push({ mime, base64 })
  }
  return images.length === 0
    ? failure('invalid_response', 'The image service returned an unrecognized response.')
    : { ok: true, images }
}

/** 只支持本产品用到的三条图像路径；base 已含 `/v1` 时不重复拼。 */
export function imageEndpointUrl(baseUrl: string, endpoint: 'generations' | 'edits'): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  const prefix = /\/v\d+(?:beta)?(?:$|\/)/i.test(trimmed) ? trimmed : `${trimmed}/v1`
  return `${prefix}/images/${endpoint}`
}

export function imageBase64ByteLength(base64: string): number {
  const clean = base64.replace(/=+$/, '')
  return Math.floor((clean.length * 3) / 4)
}

function failure(reasonCode: string, message: string): GeneratedImagePayloadOutcome {
  return { ok: false, reasonCode, message }
}
