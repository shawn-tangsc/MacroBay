import { describe, expect, it } from 'vitest'

import {
  applyClaudeCodeOutputLimitEnv,
  DEFAULT_CLAUDE_CODE_MAX_OUTPUT_TOKENS,
  resolveClaudeCodeOutputLimit
} from './ClaudeCodeOutputLimit'
import {
  AgentTurnOutputTruncatedError,
  AGENT_TURN_OUTPUT_TRUNCATED_CODE,
  AGENT_TURN_OUTPUT_TRUNCATED_NOTICE,
  buildAgentTurnOutputTruncatedDiagnosticText,
  isClaudeCodeOutputTruncationErrorCode,
  isClaudeCodeOutputTruncationStopReason
} from './ClaudeCodeOutputTruncation'

describe('Claude Code output limit', () => {
  it('uses the model max completion tokens capability when it is declared', () => {
    expect(resolveClaudeCodeOutputLimit(65536)).toEqual({
      maxOutputTokens: 65536,
      source: 'model-capability'
    })
  })

  it('uses the documented safe default when no capability is declared', () => {
    expect(resolveClaudeCodeOutputLimit(undefined)).toEqual({
      maxOutputTokens: DEFAULT_CLAUDE_CODE_MAX_OUTPUT_TOKENS,
      source: 'safe-default'
    })
    expect(DEFAULT_CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe(32000)
  })

  it('ignores invalid capability values instead of requesting a broken limit', () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveClaudeCodeOutputLimit(value)).toEqual({
        maxOutputTokens: DEFAULT_CLAUDE_CODE_MAX_OUTPUT_TOKENS,
        source: 'safe-default'
      })
    }
  })

  it('writes the limit into the SDK environment without mutating the input env', () => {
    const env = { FOO: 'bar' }
    const applied = applyClaudeCodeOutputLimitEnv(env, {
      maxOutputTokens: 65536,
      source: 'model-capability'
    })

    expect(applied.env).toEqual({ FOO: 'bar', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '65536' })
    expect(applied.outputLimit).toEqual({ maxOutputTokens: 65536, source: 'model-capability' })
    expect(env).toEqual({ FOO: 'bar' })
  })

  it('lets an explicit environment value win over the model capability', () => {
    const applied = applyClaudeCodeOutputLimitEnv(
      { CLAUDE_CODE_MAX_OUTPUT_TOKENS: '24000' },
      { maxOutputTokens: 65536, source: 'model-capability' }
    )

    expect(applied.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe('24000')
    expect(applied.outputLimit).toEqual({ maxOutputTokens: 24000, source: 'configured' })
  })
})

describe('Claude Code output truncation', () => {
  it('recognizes the Anthropic stop_reason and the OpenAI-compatible finish_reason', () => {
    expect(isClaudeCodeOutputTruncationStopReason('max_tokens')).toBe(true)
    expect(isClaudeCodeOutputTruncationStopReason('length')).toBe(true)
    expect(isClaudeCodeOutputTruncationStopReason('end_turn')).toBe(false)
    expect(isClaudeCodeOutputTruncationStopReason('tool_use')).toBe(false)
    expect(isClaudeCodeOutputTruncationStopReason(null)).toBe(false)
  })

  it('recognizes the SDK assistant max output error code', () => {
    expect(isClaudeCodeOutputTruncationErrorCode('max_output_tokens')).toBe(true)
    expect(isClaudeCodeOutputTruncationErrorCode('max_tokens')).toBe(false)
    expect(isClaudeCodeOutputTruncationErrorCode(undefined)).toBe(false)
  })

  it('builds an explicit truncation error that carries the partial output', () => {
    const error = new AgentTurnOutputTruncatedError({
      stopReason: 'max_tokens',
      partialText: '{"stage":"write",',
      maxOutputTokens: 65536,
      outputTokens: 15137
    })

    expect(error.name).toBe('AgentTurnOutputTruncatedError')
    expect(error.code).toBe(AGENT_TURN_OUTPUT_TRUNCATED_CODE)
    expect(error.stopReason).toBe('max_tokens')
    expect(error.partialText).toBe('{"stage":"write",')
    expect(error.maxOutputTokens).toBe(65536)
    expect(error.outputTokens).toBe(15137)
    expect(error.message).toContain(AGENT_TURN_OUTPUT_TRUNCATED_NOTICE)
    expect(error.message).toContain('stop_reason=max_tokens')
    expect(error.message).toContain('单轮输出上限 65536 tokens')
    expect(error.message).toContain('已生成 15137 tokens')
  })

  it('keeps the generated text ahead of the truncation notice for diagnostics', () => {
    const error = new AgentTurnOutputTruncatedError({
      stopReason: 'length',
      partialText: '{"partial":true',
      maxOutputTokens: null,
      outputTokens: null
    })

    const diagnostic = buildAgentTurnOutputTruncatedDiagnosticText(error)

    expect(diagnostic.startsWith('{"partial":true')).toBe(true)
    expect(diagnostic).toContain(AGENT_TURN_OUTPUT_TRUNCATED_NOTICE)
  })

  it('returns only the notice when no text was generated before truncation', () => {
    const error = new AgentTurnOutputTruncatedError({
      stopReason: 'max_tokens',
      partialText: '   '
    })

    expect(buildAgentTurnOutputTruncatedDiagnosticText(error)).toBe(error.message)
  })
})
