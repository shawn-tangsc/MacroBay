export const agentObservabilityExporterModes = [
  'disabled',
  'console',
  'local-otlp',
  'remote-otlp'
] as const

export type AgentObservabilityExporterMode = (typeof agentObservabilityExporterModes)[number]

export type AgentObservabilitySettings = {
  exporterMode: AgentObservabilityExporterMode
  remoteEndpoint: string
  includePrompts: boolean
  includeToolContent: boolean
}

export function createDefaultAgentObservabilitySettings(): AgentObservabilitySettings {
  return {
    exporterMode: 'console',
    remoteEndpoint: '',
    includePrompts: false,
    includeToolContent: false
  }
}

export function isAgentObservabilityExporterMode(value: unknown): value is AgentObservabilityExporterMode {
  return (
    typeof value === 'string' &&
    (agentObservabilityExporterModes as readonly string[]).includes(value)
  )
}

export function normalizeAgentObservabilitySettings(
  value: unknown,
  defaults: AgentObservabilitySettings = createDefaultAgentObservabilitySettings()
): AgentObservabilitySettings {
  if (!value || typeof value !== 'object') return defaults
  const candidate = value as Partial<Record<keyof AgentObservabilitySettings, unknown>>
  return {
    exporterMode: isAgentObservabilityExporterMode(candidate.exporterMode)
      ? candidate.exporterMode
      : defaults.exporterMode,
    remoteEndpoint:
      typeof candidate.remoteEndpoint === 'string' ? candidate.remoteEndpoint.trim() : defaults.remoteEndpoint,
    includePrompts:
      typeof candidate.includePrompts === 'boolean' ? candidate.includePrompts : defaults.includePrompts,
    includeToolContent:
      typeof candidate.includeToolContent === 'boolean'
        ? candidate.includeToolContent
        : defaults.includeToolContent
  }
}

export function shouldEnableLocalOtlpBridge(settings: AgentObservabilitySettings): boolean {
  return settings.exporterMode === 'local-otlp'
}

export function shouldExportRemoteOtlp(settings: AgentObservabilitySettings): boolean {
  return settings.exporterMode === 'remote-otlp' && settings.remoteEndpoint.length > 0
}
