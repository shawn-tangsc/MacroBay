import { platformWebSearchSessionToolName } from '@platform/ai/agent-platform/tools/platformWebTools'

/**
 * Which web tools one daily-brief editor session may auto-approve.
 *
 * Two paths, one consent switch:
 *  - first-party Anthropic endpoint → the built-in WebSearch/WebFetch server tools;
 *  - any other provider → the platform `web_search` function tool, because the built-in server
 *    tool schema is rejected with `400 tools.0.input_schema`.
 *
 * Authorization, provider readiness and the consent bit are checked here; the runtime still
 * disallows the built-ins for unsupported providers, so a stale allowlist cannot leak a bad schema.
 */
export function resolveDailyBriefAgentAllowedTools(input: Readonly<{
  webSearchEnabled: boolean
  authorized: boolean
  providerReady: boolean
  serverWebSearchSupported: boolean
}>): string[] | undefined {
  if (!input.webSearchEnabled || !input.authorized || !input.providerReady) return undefined
  return input.serverWebSearchSupported
    ? ['WebSearch', 'WebFetch']
    : [platformWebSearchSessionToolName]
}
