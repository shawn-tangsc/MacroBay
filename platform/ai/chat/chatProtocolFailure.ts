/**
 * T4/T5：协议适配器的失败契约（中性，助手与智能体共用）。
 *
 * 适配器只抛这个错误；助手侧再把它翻译成既有的 `AssistantInvocationFailureError`
 * （保留失败证据语义），智能体侧按 `provider-request-failed` 处理。
 * 摘要里不含 Key；原始 body 交给调用方统一脱敏。
 */
export type ChatProtocolFailureEvidence = {
  phase: 'request' | 'response'
  summary: string
  httpStatus?: number
  body?: string
  /**
   * 上游返回体里的**机器码**（`error.code` / `error.type` / 顶层 `code`）。
   *
   * 只放结构字段，不放文案：运行期靠它判「余额用尽」这类可判定事实，
   * 从正文里认字是猜测（同一个意思每天换一种写法）。
   */
  upstreamCode?: string
}

export class ChatProtocolFailureError extends Error {
  readonly evidence: ChatProtocolFailureEvidence

  constructor(evidence: ChatProtocolFailureEvidence) {
    super('provider-request-failed')
    this.name = 'ChatProtocolFailureError'
    this.evidence = evidence
  }
}

export async function readChatProviderFailure(
  response: Response
): Promise<{ summary: string; body?: string; upstreamCode?: string }> {
  const body = await response.text()
  try {
    const payload = JSON.parse(body) as {
      error?: { message?: unknown; code?: unknown; type?: unknown }
      code?: unknown
    }
    const summary = typeof payload.error?.message === 'string' ? payload.error.message.trim() : ''
    // 只取**字符串型机器码**：数字、对象、数组一律当作「没有这个字段」，不去猜它的形状。
    const upstreamCode = [payload.error?.code, payload.error?.type, payload.code]
      .find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim() !== '')
      ?.trim()
      .toLowerCase()
    return {
      summary: summary || `HTTP ${response.status}`,
      ...(body.trim() ? { body } : {}),
      ...(upstreamCode === undefined ? {} : { upstreamCode })
    }
  } catch {
    return { summary: `HTTP ${response.status}`, ...(body.trim() ? { body } : {}) }
  }
}
