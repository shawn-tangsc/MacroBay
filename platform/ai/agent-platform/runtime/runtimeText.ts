export type RuntimeTextDescriptor = {
  key: string
  params?: Record<string, string | number | boolean>
  fallback: string
}

export type RuntimeTextPart = {
  type: 'runtime-text'
  key: string
  params?: Record<string, string | number | boolean>
  fallback: string
  text: string
}

export const runtimeTextKeys = {
  connecting: 'agent.runtime.connecting',
  stopped: 'agent.runtime.stopped',
  seedAgentName: 'agent.seed.defaultAssistant.name',
  seedAgentDescription: 'agent.seed.defaultAssistant.description',
  seedAgentInstructions: 'agent.seed.defaultAssistant.instructions',
  seedSessionName: 'agent.seed.defaultSession.name',
  seedSessionDescription: 'agent.seed.defaultSession.description',
  seedWelcomeMessage: 'agent.seed.defaultSession.welcome',
  seedWorkspaceName: 'agent.seed.defaultWorkspace.name',
  seedUnconfiguredModelName: 'agent.seed.unconfiguredModel.name'
} as const

export type RuntimeTextKey = (typeof runtimeTextKeys)[keyof typeof runtimeTextKeys]

export function createRuntimeTextDescriptor(
  key: string,
  fallback: string,
  params?: Record<string, string | number | boolean>
): RuntimeTextDescriptor {
  return params ? { key, fallback, params } : { key, fallback }
}

export function createRuntimeTextPart(descriptor: RuntimeTextDescriptor): RuntimeTextPart {
  return {
    type: 'runtime-text',
    key: descriptor.key,
    fallback: descriptor.fallback,
    text: descriptor.fallback,
    ...(descriptor.params ? { params: descriptor.params } : {})
  }
}

export function createRuntimeTextDataFromDescriptor(descriptor: RuntimeTextDescriptor): {
  parts: RuntimeTextPart[]
} {
  return { parts: [createRuntimeTextPart(descriptor)] }
}

export function isRuntimeTextDescriptor(value: unknown): value is RuntimeTextDescriptor {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RuntimeTextDescriptor>
  return typeof candidate.key === 'string' && typeof candidate.fallback === 'string'
}

export function isRuntimeTextPart(value: unknown): value is RuntimeTextPart {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RuntimeTextPart>
  return (
    candidate.type === 'runtime-text' &&
    typeof candidate.key === 'string' &&
    typeof candidate.fallback === 'string' &&
    typeof candidate.text === 'string'
  )
}

export function resolveRuntimeText(
  descriptor: RuntimeTextDescriptor,
  catalog?: Partial<Record<string, string | ((params: Record<string, string | number | boolean>) => string)>>
): string {
  const entry = catalog?.[descriptor.key]
  if (typeof entry === 'function') {
    return entry(descriptor.params ?? {})
  }
  if (typeof entry === 'string' && entry.trim()) {
    return entry
  }
  return descriptor.fallback
}

export function resolveRuntimeTextPart(
  part: RuntimeTextPart,
  catalog?: Partial<Record<string, string | ((params: Record<string, string | number | boolean>) => string)>>
): string {
  return resolveRuntimeText(
    {
      key: part.key,
      fallback: part.fallback,
      ...(part.params ? { params: part.params } : {})
    },
    catalog
  )
}

export const runtimeStatusText = {
  connecting: createRuntimeTextDescriptor(runtimeTextKeys.connecting, '正在连接模型服务...'),
  stopped: createRuntimeTextDescriptor(runtimeTextKeys.stopped, '已停止。')
} as const
