/**
 * Agent 单轮输出上限。
 *
 * 调用链里没有任何一处由 MacroBay 显式设置 `max_tokens`：Claude Code CLI 自己决定每个请求的
 * 输出上限（内置模型登记表 + `CLAUDE_CODE_MAX_OUTPUT_TOKENS`），未声明能力的第三方模型回退到
 * 32000，并把它限制在登记表的上限内（未知模型为 64000）。日报写作一次输出两万多 token 时，
 * 这个默认值就是截断点，所以这里把「模型自己声明的输出能力」翻译成 CLI 认识的环境变量。
 */

export const CLAUDE_CODE_MAX_OUTPUT_TOKENS_ENV_KEY = 'CLAUDE_CODE_MAX_OUTPUT_TOKENS'

/**
 * 无能力值时的安全默认。
 *
 * 取 32000 而不是 4096/16384：它与 CLI 当前对未知模型的默认值一致，没有能力声明的模型行为不变；
 * 有 `maxCompletionTokens` 的模型以能力值为准，不受这个常量影响。
 */
export const DEFAULT_CLAUDE_CODE_MAX_OUTPUT_TOKENS = 32_000

export type ClaudeCodeOutputLimitSource = 'model-capability' | 'safe-default' | 'configured'

export type ClaudeCodeOutputLimit = {
  maxOutputTokens: number
  /** 这个值从哪来：模型能力 / 安全默认 / 调用方显式配置的环境变量。 */
  source: ClaudeCodeOutputLimitSource
}

/**
 * 解析本回合的输出上限。模型能力（`maxCompletionTokens`）优先；没有合法声明时用安全默认。
 */
export function resolveClaudeCodeOutputLimit(modelMaxCompletionTokens?: number | null): ClaudeCodeOutputLimit {
  const declared = toPositiveInteger(modelMaxCompletionTokens)
  if (declared !== null) {
    return { maxOutputTokens: declared, source: 'model-capability' }
  }

  return { maxOutputTokens: DEFAULT_CLAUDE_CODE_MAX_OUTPUT_TOKENS, source: 'safe-default' }
}

/**
 * 把上限写进 SDK 子进程环境。调用方（agent 组合环境或 provider 环境）显式设置的
 * `CLAUDE_CODE_MAX_OUTPUT_TOKENS` 优先，不会被模型能力覆盖。
 */
export function applyClaudeCodeOutputLimitEnv(
  env: Record<string, string>,
  limit: ClaudeCodeOutputLimit
): { env: Record<string, string>; outputLimit: ClaudeCodeOutputLimit } {
  const configured = toPositiveInteger(env[CLAUDE_CODE_MAX_OUTPUT_TOKENS_ENV_KEY])
  if (configured !== null) {
    return { env, outputLimit: { maxOutputTokens: configured, source: 'configured' } }
  }

  return {
    env: { ...env, [CLAUDE_CODE_MAX_OUTPUT_TOKENS_ENV_KEY]: String(limit.maxOutputTokens) },
    outputLimit: limit
  }
}

function toPositiveInteger(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value.trim(), 10)
        : Number.NaN
  if (!Number.isFinite(parsed)) return null

  const normalized = Math.floor(parsed)
  return normalized > 0 ? normalized : null
}
