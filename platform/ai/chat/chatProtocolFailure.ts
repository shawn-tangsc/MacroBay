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
}

export class ChatProtocolFailureError extends Error {
  readonly evidence: ChatProtocolFailureEvidence

  constructor(evidence: ChatProtocolFailureEvidence) {
    super('provider-request-failed')
    this.name = 'ChatProtocolFailureError'
    this.evidence = evidence
  }
}

export async function readChatProviderFailure(response: Response): Promise<{ summary: string; body?: string }> {
  const body = await response.text()
  try {
    const payload = JSON.parse(body) as { error?: { message?: unknown } }
    const summary = typeof payload.error?.message === 'string' ? payload.error.message.trim() : ''
    return { summary: summary || `HTTP ${response.status}`, ...(body.trim() ? { body } : {}) }
  } catch {
    return { summary: `HTTP ${response.status}`, ...(body.trim() ? { body } : {}) }
  }
}
