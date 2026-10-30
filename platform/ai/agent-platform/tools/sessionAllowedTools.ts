import { claudeCodeBuiltinTools } from './builtinClaudeTools'

const builtinToolNames: ReadonlySet<string> = new Set(claudeCodeBuiltinTools.map((tool) => tool.id))

/**
 * 会话级工具白名单只接受 **builtin** 工具名（WebSearch/WebFetch 等）。
 *
 * 产品可以在创建一次会话时要求"这一次自动放行 WebSearch"，而不改 agent 配置；但白名单
 * 不能成为绕过工具策略的入口：未知名字、MCP/Skill 的运行时名字、空串一律丢弃，重复项按
 * 首次出现去重。语义由这里单点决定，repository、store、settings builder 都复用它。
 */
export function normalizeSessionAllowedTools(values: readonly string[] | undefined | null): string[] {
  if (!values || values.length === 0) return []

  const seen = new Set<string>()
  const normalized: string[] = []
  for (const value of values) {
    if (typeof value !== 'string') continue
    const name = value.trim()
    if (!name || seen.has(name) || !builtinToolNames.has(name)) continue
    seen.add(name)
    normalized.push(name)
  }
  return normalized
}

export function isBuiltinToolName(name: string): boolean {
  return builtinToolNames.has(name)
}
