export const runtimeCredentialActionIds = [
  'open-url',
  'restart',
  'open-settings',
  'copy-hint',
  'retry'
] as const

export type RuntimeCredentialActionId = (typeof runtimeCredentialActionIds)[number]

export type RuntimeCredentialAction = {
  id: RuntimeCredentialActionId
  labelKey: string
  url?: string
  hint?: string
}

export type BuildRuntimeCredentialActionsInput = {
  status: 'connected' | 'connecting' | 'error' | 'disabled'
  errorKind?: 'abort' | 'config' | 'dependency' | 'auth' | 'transient'
  message?: string
  retryable?: boolean
  providerUrl?: string | null
  baseUrl?: string | null
}

const LABEL_KEYS = {
  openUrl: 'editor.tools.mcpActionOpenUrl',
  restart: 'editor.tools.mcpActionRestart',
  openSettings: 'editor.tools.mcpActionOpenSettings',
  copyHint: 'editor.tools.mcpActionCopyHint',
  retry: 'editor.tools.mcpActionRetry'
} as const

export function buildMcpRuntimeCredentialActions(
  input: BuildRuntimeCredentialActionsInput
): RuntimeCredentialAction[] {
  if (input.status !== 'error') return []

  const actions: RuntimeCredentialAction[] = []
  const hint = normalizeHint(input.message)
  const openUrl = resolveOpenUrl(input)

  if (input.errorKind === 'auth' && openUrl) {
    actions.push({
      id: 'open-url',
      labelKey: LABEL_KEYS.openUrl,
      url: openUrl
    })
  }

  if (input.errorKind === 'auth' || input.errorKind === 'config' || input.errorKind === 'dependency') {
    actions.push({
      id: 'open-settings',
      labelKey: LABEL_KEYS.openSettings
    })
  }

  if (hint) {
    actions.push({
      id: 'copy-hint',
      labelKey: LABEL_KEYS.copyHint,
      hint
    })
  }

  if (input.errorKind === 'transient' || input.retryable === true || input.errorKind === 'abort') {
    actions.push({
      id: 'retry',
      labelKey: LABEL_KEYS.retry
    })
  } else if (input.errorKind === 'auth' || input.errorKind === 'config' || !input.errorKind) {
    actions.push({
      id: 'restart',
      labelKey: LABEL_KEYS.restart
    })
  }

  return dedupeActions(actions)
}

function resolveOpenUrl(input: BuildRuntimeCredentialActionsInput): string | undefined {
  const providerUrl = normalizeUrl(input.providerUrl)
  if (providerUrl) return providerUrl

  const fromMessage = extractHttpUrl(input.message)
  if (fromMessage) return fromMessage

  return normalizeUrl(input.baseUrl)
}

function normalizeHint(message: string | undefined): string | undefined {
  const trimmed = message?.trim()
  return trimmed ? trimmed : undefined
}

function normalizeUrl(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return undefined
}

function extractHttpUrl(message: string | undefined): string | undefined {
  if (!message) return undefined
  const match = message.match(/https?:\/\/[^\s"'<>]+/i)
  return match?.[0]?.replace(/[.,;:!?)]+$/, '')
}

function dedupeActions(actions: RuntimeCredentialAction[]): RuntimeCredentialAction[] {
  const seen = new Set<RuntimeCredentialActionId>()
  return actions.filter((action) => {
    if (seen.has(action.id)) return false
    seen.add(action.id)
    return true
  })
}
