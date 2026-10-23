import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

export type AgentAttachmentKind = 'text' | 'document' | 'image' | 'unsupported'

const textExtensions = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'js',
  'ts',
  'tsx',
  'jsx',
  'py',
  'rs',
  'go',
  'java',
  'kt',
  'swift',
  'yaml',
  'yml',
  'toml',
  'ini',
  'csv',
  'log',
  'sql',
  'sh',
  'zsh',
  'bash'
])

const documentExtensions = new Set(['pdf', 'doc', 'docx', 'rtf'])
const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'])

export function supportsVisionAttachments(
  uniqueModelId: string | null | undefined,
  providers: readonly SafeModelProvider[]
): boolean {
  const modelId = uniqueModelId?.trim()
  if (!modelId) return false

  const separatorIndex = modelId.indexOf(':')
  if (separatorIndex <= 0) return false
  const providerId = modelId.slice(0, separatorIndex)
  const actualModelId = modelId.slice(separatorIndex + 1)

  const provider = providers.find((item) => item.id === providerId)
  const model = provider?.models.find((item) => item.id === actualModelId)
  return model?.capabilities.vision === true
}

export function classifyAgentAttachment(path: string, allowImage: boolean): AgentAttachmentKind {
  const extension = getFileExtension(path)
  if (!extension) return 'text'
  if (textExtensions.has(extension)) return 'text'
  if (documentExtensions.has(extension)) return 'document'
  if (imageExtensions.has(extension)) return allowImage ? 'image' : 'unsupported'
  return 'unsupported'
}

function getFileExtension(path: string): string {
  const filename = path.split(/[\\/]/).pop() ?? path
  const separatorIndex = filename.lastIndexOf('.')
  if (separatorIndex <= 0) return ''
  return filename.slice(separatorIndex + 1).toLowerCase()
}
