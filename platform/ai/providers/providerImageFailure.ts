import type { ModelProvider } from './modelProviderTypes'

/**
 * 图像端点的失败文案卫生（生成 / 编辑共用）：
 * - 传输层错误只留人话，URL 抹成 `[url]`，Key 抹成 `[redacted]`；
 * - 上游可能回显自定义请求头值，返回前一律抹掉；
 * - 结果长度封顶，绝不带原始 JSON / base64 回渲染层。
 */
export function describeImageTransportFailure(error: unknown, apiKey: string): string {
  const text = error instanceof Error ? error.message : ''
  const safe = apiKey ? text.split(apiKey).join('[redacted]') : text
  return (safe.replace(/https?:\/\/\S+/gi, '[url]').slice(0, 180).trim()) || 'Image request failed.'
}

export function redactImageFailureSecrets(message: string, provider: ModelProvider): string {
  let safe = message
  for (const header of provider.customHeaders ?? []) {
    const value = header.value.trim()
    if (value.length < 4) continue
    safe = safe.split(value).join('[redacted]')
  }
  return safe
}
