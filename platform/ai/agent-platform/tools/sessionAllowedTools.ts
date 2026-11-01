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
const autoApprovedBuiltinNames: ReadonlySet<string> = new Set(
  claudeCodeBuiltinTools.filter((tool) => tool.approval === 'auto').map((tool) => tool.id)
)

/**
 * 允许以 bare name 直接写进 SDK `allowedTools` 的 builtin。
 *
 * 只读（sessionReadOnlyBuiltinTools）、默认自动批准、且不是会话拒绝名单里的工具：
 * Read / Glob / Grep / NotebookRead。这类工具没有审批或能力门控，预授权只影响顺序；
 * 其余工具即使已批准也不能进 SDK `allowedTools` —— bare name 会让 SDK 自动放行整个工具，
 * canUseTool 不再被调用（`CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`）。Task/TodoWrite 虽然 catalog
 * 标记 auto，但 Task 会派生 sub-agent、TodoWrite 改计划状态，仍必须经过运行时策略。
 */
export const sessionBarePreApprovedBuiltinTools = sessionReadOnlyBuiltinTools.filter(
  (name) => autoApprovedBuiltinNames.has(name) && !blockedToolNames.has(name)
)
const barePreApprovedToolNames: ReadonlySet<string> = new Set(sessionBarePreApprovedBuiltinTools)

/** 该名字是否可以 bare 形式进入 SDK `allowedTools`（而不是只进运行时策略白名单）。 */
export function isSessionBarePreApprovedToolName(name: string): boolean {
  return barePreApprovedToolNames.has(name)
}

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
