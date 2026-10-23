/**
 * 「端点不支持」判据（按协议/端点各自定义，不复用 Messages 专用正则）。
 *
 * 命中 ⇒ `endpoint_unsupported`，且**优先于** `classifyHttpFailure`。
 */
export type DetectionEndpointTarget = 'chat-completions' | 'responses' | 'messages' | 'gemini' | 'embeddings' | 'rerank'

const NOT_SUPPORTED = /(not\s*supported|unsupported|does\s+not\s+support|不支持)/i
const NOT_FOUND = /(not\s*found|unknown|does\s+not\s+exist|不存在|未知)/i
const NO_CHANNEL = /(无可用渠道|没有可用渠道|no\s+available\s+channels?)/i

export function isEndpointUnsupported(
  target: DetectionEndpointTarget,
  status: number,
  upstreamText: string | null | undefined
): boolean {
  const text = upstreamText ?? ''
  if (target === 'messages') {
    return (status === 400 || status === 404 || status === 500)
      && /messages/i.test(text)
      && (NOT_SUPPORTED.test(text) || NO_CHANNEL.test(text) || /不支持.*协议/i.test(text))
  }
  if (target === 'responses') {
    return (status === 400 || status === 404 || status === 500)
      && /responses/i.test(text)
      && (NOT_SUPPORTED.test(text) || NOT_FOUND.test(text))
  }
  if (target === 'gemini') {
    return (status === 400 || status === 404)
      && /generatecontent/i.test(text)
      && (NOT_SUPPORTED.test(text) || NOT_FOUND.test(text))
  }
  // chat/completions、embeddings、rerank：端点名 + 不存在/不支持
  const endpointPattern = target === 'chat-completions'
    ? /chat\/?completions/i
    : new RegExp(target, 'i')
  return (status === 400 || status === 404 || status === 405)
    && (NOT_SUPPORTED.test(text) || NOT_FOUND.test(text))
    && (endpointPattern.test(text) || text.length === 0)
}
