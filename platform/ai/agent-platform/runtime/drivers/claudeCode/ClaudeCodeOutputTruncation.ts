/**
 * 单轮输出被截断的显式失败。
 *
 * 供应商把 `finish_reason: length`（Anthropic 协议里是 `stop_reason: max_tokens`）原样报上来时，
 * Claude Agent SDK 仍可能把这一轮标成 `subtype: success` / `is_error: false`，于是会话看起来
 * 「已完成」。这里把它变成一个有名字的错误，并保留已经生成的部分文本供诊断。
 */

export const AGENT_TURN_OUTPUT_TRUNCATED_CODE = 'agent-turn-output-truncated'

/**
 * 面向用户的结论：截断意味着依赖完整输出的结果没有生成。
 *
 * 放在平台层时保持任务无关的表述，只把「输出被截断」和「不会产出完整结果」说清楚。
 */
export const AGENT_TURN_OUTPUT_TRUNCATED_NOTICE =
  '输出被截断，本轮结果不完整；依赖完整输出的任务（例如日报）未生成。'

/** 供应商/Anthropic 协议的 stop_reason 与 OpenAI 兼容协议的 finish_reason。 */
const OUTPUT_TRUNCATION_STOP_REASONS = new Set(['max_tokens', 'length'])

/** Claude Agent SDK 把同一件事报在 assistant 消息的 error 码上。 */
const OUTPUT_TRUNCATION_ERROR_CODES = new Set(['max_output_tokens'])

export type AgentTurnOutputTruncationInput = {
  stopReason: string
  /** 已经生成、但还不完整的正文。截断时用它保留诊断信息。 */
  partialText?: string | null
  /** 本回合实际请求的单轮输出上限。 */
  maxOutputTokens?: number | null
  /** 上游回报的已生成 token 数。 */
  outputTokens?: number | null
}

export class AgentTurnOutputTruncatedError extends Error {
  readonly code = AGENT_TURN_OUTPUT_TRUNCATED_CODE
  readonly stopReason: string
  readonly partialText: string
  readonly maxOutputTokens: number | null
  readonly outputTokens: number | null

  constructor(input: AgentTurnOutputTruncationInput) {
    super(buildAgentTurnOutputTruncatedMessage(input))
    this.name = 'AgentTurnOutputTruncatedError'
    this.stopReason = input.stopReason
    this.partialText = typeof input.partialText === 'string' ? input.partialText : ''
    this.maxOutputTokens = toNumberOrNull(input.maxOutputTokens)
    this.outputTokens = toNumberOrNull(input.outputTokens)
  }
}

export function isClaudeCodeOutputTruncationStopReason(value: unknown): boolean {
  return typeof value === 'string' && OUTPUT_TRUNCATION_STOP_REASONS.has(value)
}

export function isClaudeCodeOutputTruncationErrorCode(value: unknown): boolean {
  return typeof value === 'string' && OUTPUT_TRUNCATION_ERROR_CODES.has(value)
}

export function isClaudeCodeOutputTruncationSignal(value: unknown): boolean {
  return isClaudeCodeOutputTruncationStopReason(value) || isClaudeCodeOutputTruncationErrorCode(value)
}

export function buildAgentTurnOutputTruncatedMessage(input: {
  stopReason: string
  maxOutputTokens?: number | null
  outputTokens?: number | null
}): string {
  const details = [
    `stop_reason=${input.stopReason}`,
    toNumberOrNull(input.maxOutputTokens) === null ? null : `单轮输出上限 ${input.maxOutputTokens} tokens`,
    toNumberOrNull(input.outputTokens) === null ? null : `已生成 ${input.outputTokens} tokens`
  ].filter((detail): detail is string => detail !== null)

  return `${AGENT_TURN_OUTPUT_TRUNCATED_NOTICE}（${details.join('，')}）`
}

/**
 * 失败消息的正文：先给已经生成的内容，再给截断结论。没有部分文本时只给结论。
 */
export function buildAgentTurnOutputTruncatedDiagnosticText(error: AgentTurnOutputTruncatedError): string {
  const partialText = error.partialText.trim()
  return partialText ? `${partialText}\n\n${error.message}` : error.message
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
