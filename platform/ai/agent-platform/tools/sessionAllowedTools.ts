import { claudeCodeBuiltinTools } from './builtinClaudeTools'
import { isPlatformWebSearchSessionToolName } from './platformWebTools'

const builtinToolNames: ReadonlySet<string> = new Set(claudeCodeBuiltinTools.map((tool) => tool.id))

/**
 * 会话白名单只接受 **只读** builtin：读取文件、检索文件、访问网络都不会改动工作区。
 * 即使一次会话把这些工具全部放开，最坏结果也只是多读一次。
 */
export const sessionReadOnlyBuiltinTools = [
  'WebSearch',
  'WebFetch',
  'Read',
  'Glob',
  'Grep',
  'NotebookRead'
] as const

/**
 * 明确拒绝的写 / 执行类 builtin。会话白名单来自调用方填写的 `CreateAgentSessionDto`，
 * 放行这些名字等于让创建会话的一方自行批准命令执行、文件写入或子 agent 执行。
 * `Task` 与 `TodoWrite` 虽不直接落盘，但前者会再起一个可执行任意工具的 sub-agent，
 * 后者改的是会话计划状态，都不属于只读语义。
 */
export const sessionBlockedBuiltinTools = [
  'Bash',
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Task',
  'TodoWrite'
] as const

const readOnlyToolNames: ReadonlySet<string> = new Set(sessionReadOnlyBuiltinTools)
const blockedToolNames: ReadonlySet<string> = new Set(sessionBlockedBuiltinTools)

/**
 * 会话级工具白名单只接受 **只读** 工具名：
 *  - Claude Code builtin：WebSearch/WebFetch/Read/Glob/Grep 等；
 *  - 平台自己的只读 web 工具 `web_search`（provider 不支持 Anthropic server tool 时使用，
 *    由平台 WebSearchService 执行，schema 显式声明 query/maxResults）。
 *
 * 产品可以在创建一次会话时要求"这一次自动放行 WebSearch"，而不改 agent 配置；但白名单
 * 不能成为绕过工具策略的入口：写 / 执行类 builtin（Bash/Write/Edit...）、未知名字、
 * MCP/Skill 的运行时名字、空串一律丢弃，重复项按首次出现去重。语义由这里单点决定，
 * repository、store、settings builder 都复用它。
 */
export function normalizeSessionAllowedTools(values: readonly string[] | undefined | null): string[] {
  if (!values || values.length === 0) return []

  const seen = new Set<string>()
  const normalized: string[] = []
  for (const value of values) {
    if (typeof value !== 'string') continue
    const name = value.trim()
    if (!name || seen.has(name)) continue
    if (!isSessionAllowableToolName(name)) continue
    seen.add(name)
    normalized.push(name)
  }
  return normalized
}

export function isBuiltinToolName(name: string): boolean {
  return builtinToolNames.has(name)
}

/** 会话白名单是否允许该名字：只读 builtin 或只读平台 web 工具，且不与写/执行拒绝名单冲突。 */
export function isSessionAllowableToolName(name: string): boolean {
  if (blockedToolNames.has(name)) return false
  if (isPlatformWebSearchSessionToolName(name)) return true
  return readOnlyToolNames.has(name) && builtinToolNames.has(name)
}
