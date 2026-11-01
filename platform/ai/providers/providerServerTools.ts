import type { ProviderChatEndpoint } from './modelProviderTypes'
import { resolveProviderChatBase } from './providerChatEndpoints'
import { providerServerToolSupportOf } from './providerPresets'

/**
 * Claude Code built-in WebSearch 在真正搜索时会再发一个嵌套模型请求，`tools[0]` 是 Anthropic
 * server tool（`web_search_20250305`，没有 `input_schema`）。第三方 Anthropic 兼容端点通常按
 * function tool 校验，会把这种请求判成 `400 tools.0.input_schema`。
 *
 * WebFetch 自己不是 server tool，但它在非 first-party 环境里要做域名安全预检
 * （`Unable to verify if domain ... is safe to fetch`），同样不可用。两者都按同一份
 * 「Anthropic server-side 网络工具」能力处理，避免 UI 显示已授权、实际不可用。
 */
export const ANTHROPIC_SERVER_WEB_TOOL_NAMES = ['WebSearch', 'WebFetch'] as const

export type AnthropicServerWebToolName = (typeof ANTHROPIC_SERVER_WEB_TOOL_NAMES)[number]

const anthropicServerWebToolNames: ReadonlySet<string> = new Set(ANTHROPIC_SERVER_WEB_TOOL_NAMES)

export type ProviderServerToolEndpointSource = {
  readonly id: string
  readonly endpoints: readonly ProviderChatEndpoint[]
}

/**
 * 该供应商的 Messages 端点是否支持 Anthropic server-side web search。
 *
 * 判据只有两步，缺一不可：
 *  1. 预设**显式声明** `serverTools.webSearch: true`（数据事实，见 `presets/international.ts`）；
 *  2. `messages` 端点仍是官方 first-party 地址 `https://api.anthropic.com`。
 *
 * 第 2 步是必要的二次校验：预设端点允许用户改地址，把 anthropic 供应商指向中转站后，
 * 预设声明就不再成立。自定义供应商没有预设声明，永远 fail closed；不使用
 * `baseUrl.includes('anthropic')` 这类主机名子串判断。
 */
export function supportsAnthropicServerWebSearch(provider: ProviderServerToolEndpointSource): boolean {
  if (providerServerToolSupportOf(provider.id)?.webSearch !== true) return false
  return isOfficialAnthropicMessagesBase(resolveProviderChatBase(provider, 'messages'))
}

/** 官方 first-party Messages base：https、无端口、主机精确为 api.anthropic.com、无额外路径。 */
export function isOfficialAnthropicMessagesBase(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false
  try {
    const url = new URL(baseUrl)
    if (url.protocol !== 'https:') return false
    if (url.hostname !== 'api.anthropic.com') return false
    if (url.port !== '') return false
    // `buildMessagesUrl` accepts both the bare origin and an explicit `/v1` prefix; anything else
    // would produce `/something/v1/messages` and is not an official first-party route.
    return url.pathname === '' || url.pathname === '/' || url.pathname === '/v1' || url.pathname === '/v1/'
  } catch {
    return false
  }
}

export function isAnthropicServerWebToolName(name: string): name is AnthropicServerWebToolName {
  return anthropicServerWebToolNames.has(name)
}
