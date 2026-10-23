import type { AgentSessionMessageEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'

export type AgentMessageFileArtifactOperation = 'edited' | 'generated' | 'read'
export type AgentMessageFileArtifactKind = 'document' | 'code' | 'file'

export type AgentMessageFileArtifact = {
  id: string
  absolutePath: string
  displayPath: string
  fileName: string
  extension: string | null
  kind: AgentMessageFileArtifactKind
  operation: AgentMessageFileArtifactOperation
}

export type AgentMessageFileArtifactSummary = {
  totalCount: number
  editedCount: number
  generatedCount: number
  readCount: number
  addedLines?: number
  removedLines?: number
  files: AgentMessageFileArtifact[]
}

type AgentMessagePart = AgentSessionMessageEntity['data']['parts'][number]

type BuildAgentMessageFileArtifactsOptions = {
  workspacePath?: string | null
}

type CollectedFilePath = {
  path: string
  operation: AgentMessageFileArtifactOperation
}

const EDIT_TOOL_NAMES = new Set(['edit', 'multiedit', 'write', 'notebookedit'])
const READ_TOOL_NAMES = new Set(['read', 'notebookread'])
const OPERATION_PRIORITY: Record<AgentMessageFileArtifactOperation, number> = {
  read: 0,
  generated: 1,
  edited: 2
}
const DOCUMENT_EXTENSIONS = new Set([
  'md',
  'markdown',
  'txt',
  'rst',
  'pdf',
  'doc',
  'docx',
  'csv',
  'tsv',
  'xls',
  'xlsx',
  'json',
  'yaml',
  'yml'
])
const CODE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'c',
  'cc',
  'cpp',
  'h',
  'hpp',
  'cs',
  'php',
  'rb',
  'sh',
  'zsh',
  'sql',
  'html',
  'css',
  'scss',
  'vue',
  'svelte'
])

export function buildAgentMessageFileArtifacts(
  parts: readonly AgentMessagePart[],
  options: BuildAgentMessageFileArtifactsOptions = {}
): AgentMessageFileArtifactSummary {
  const collected = parts.flatMap(collectFilePathsFromPart)
  const filesByPath = new Map<string, AgentMessageFileArtifact>()

  for (const item of collected) {
    const absolutePath = normalizeLocalPath(item.path)
    if (!absolutePath || !isAbsoluteLocalPath(absolutePath)) continue

    const existing = filesByPath.get(absolutePath)
    if (existing && OPERATION_PRIORITY[existing.operation] >= OPERATION_PRIORITY[item.operation]) continue

    filesByPath.set(absolutePath, toFileArtifact(absolutePath, item.operation, options.workspacePath))
  }

  const allFiles = [...filesByPath.values()]
  const files = allFiles.filter((file) => file.operation !== 'read')
  const stats = collectDiffStats(parts)
  return {
    totalCount: files.length,
    editedCount: files.filter((file) => file.operation === 'edited').length,
    generatedCount: files.filter((file) => file.operation === 'generated').length,
    readCount: allFiles.filter((file) => file.operation === 'read').length,
    ...(stats ? { addedLines: stats.addedLines, removedLines: stats.removedLines } : {}),
    files
  }
}

function collectFilePathsFromPart(part: AgentMessagePart): CollectedFilePath[] {
  if (part.type === 'claude-sdk-tool-call') {
    const toolName = typeof part.toolName === 'string' ? part.toolName.toLowerCase() : ''
    if (EDIT_TOOL_NAMES.has(toolName)) {
      return collectToolInputPaths(part.input, 'edited')
    }
    if (READ_TOOL_NAMES.has(toolName)) {
      return collectToolInputPaths(part.input, 'read')
    }
  }

  if (part.type === 'claude-sdk-tool-result' && part.isError !== true) {
    return collectResourcePaths(part.content).map((path) => ({ path, operation: 'generated' }))
  }

  return []
}

function collectToolInputPaths(input: unknown, operation: AgentMessageFileArtifactOperation): CollectedFilePath[] {
  if (!isRecord(input)) return []
  return ['file_path', 'path', 'notebook_path']
    .map((key) => input[key])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((path) => ({ path, operation }))
}

function collectResourcePaths(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectResourcePaths)
  if (!isRecord(value)) return []

  const paths: string[] = []
  if (value.type === 'resource' && isRecord(value.resource) && typeof value.resource.uri === 'string') {
    const filePath = readFileUriPath(value.resource.uri)
    if (filePath) paths.push(filePath)
  }

  for (const nested of Object.values(value)) {
    if (nested && typeof nested === 'object') {
      paths.push(...collectResourcePaths(nested))
    }
  }
  return paths
}

function collectDiffStats(parts: readonly AgentMessagePart[]): { addedLines: number; removedLines: number } | null {
  for (const part of parts) {
    const stats = findDiffStats(part)
    if (stats) return stats
  }
  return null
}

function findDiffStats(value: unknown): { addedLines: number; removedLines: number } | null {
  if (typeof value === 'string') {
    const match = value.match(/\+([0-9][0-9,]*)\s+-([0-9][0-9,]*)/)
    if (!match) return null
    return {
      addedLines: Number(match[1]!.replaceAll(',', '')),
      removedLines: Number(match[2]!.replaceAll(',', ''))
    }
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const stats = findDiffStats(item)
      if (stats) return stats
    }
    return null
  }

  if (isRecord(value)) {
    for (const item of Object.values(value)) {
      const stats = findDiffStats(item)
      if (stats) return stats
    }
  }

  return null
}

function toFileArtifact(
  absolutePath: string,
  operation: AgentMessageFileArtifactOperation,
  workspacePath: string | null | undefined
): AgentMessageFileArtifact {
  const fileName = readFileName(absolutePath)
  const extension = readExtension(fileName)
  return {
    id: absolutePath,
    absolutePath,
    displayPath: buildDisplayPath(absolutePath, workspacePath),
    fileName,
    extension,
    kind: classifyFileKind(extension),
    operation
  }
}

function buildDisplayPath(absolutePath: string, workspacePath: string | null | undefined): string {
  const normalizedWorkspace = normalizeLocalPath(workspacePath)
  if (normalizedWorkspace && absolutePath.startsWith(`${normalizedWorkspace}/`)) {
    return absolutePath.slice(normalizedWorkspace.length + 1)
  }
  return absolutePath
}

function classifyFileKind(extension: string | null): AgentMessageFileArtifactKind {
  const normalized = extension?.toLowerCase()
  if (!normalized) return 'file'
  if (CODE_EXTENSIONS.has(normalized)) return 'code'
  if (DOCUMENT_EXTENSIONS.has(normalized)) return 'document'
  return 'file'
}

function readFileName(path: string): string {
  const segments = path.split('/')
  return segments.at(-1) || path
}

function readExtension(fileName: string): string | null {
  const index = fileName.lastIndexOf('.')
  if (index <= 0 || index === fileName.length - 1) return null
  return fileName.slice(index + 1).toUpperCase()
}

function normalizeLocalPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const normalized = trimmed.replaceAll('\\', '/').replace(/\/+$/, '')
  return normalized || trimmed
}

function isAbsoluteLocalPath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:\//.test(value)
}

function readFileUriPath(resourceUri: string): string | null {
  try {
    const parsed = new URL(resourceUri)
    if (parsed.protocol !== 'file:') return null
    const pathname = decodeURIComponent(parsed.pathname)
    if (!pathname) return null
    if (parsed.host) return `//${parsed.host}${pathname}`
    if (/^\/[A-Za-z]:\//.test(pathname)) return pathname.slice(1)
    return pathname
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
