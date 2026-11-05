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

/**
 * The run-time wrapper: read the editor's settings once and answer what this session may auto-approve.
 *
 * Kept beside the pure resolver so the module that assembles the briefing service stays a list of
 * ports instead of a closure body — the same reason the publisher has a factory.
 */
export type BriefingEditorSettingsView = Readonly<{
  settings: Readonly<{ webSearchEnabled: boolean; webSearchAuthorizedAt?: string | null }>
  /** Whether this build's provider can carry the built-in server tools at all. */
  webSearchSupported: boolean
}>

export async function resolveBriefingRunAllowedTools(input: Readonly<{
  getView: () => Promise<BriefingEditorSettingsView>
  isWebSearchProviderReady?: () => Promise<boolean>
}>): Promise<string[] | undefined> {
  const view = await input.getView()
  const providerReady = input.isWebSearchProviderReady ? await input.isWebSearchProviderReady() : true
  return resolveDailyBriefAgentAllowedTools({
    webSearchEnabled: view.settings.webSearchEnabled,
    authorized: Boolean(view.settings.webSearchAuthorizedAt),
    providerReady,
    serverWebSearchSupported: view.webSearchSupported
  })
}
