import type { AgentRuntimeMessagePartDetail, AgentRuntimeMessagePartDetailItem } from './agentRuntimeMessagePartTypes'

export function selectToolResultDetailValue(part: {
  output?: unknown
  content?: unknown
  structuredContent?: unknown
}): unknown {
  if (part.structuredContent !== undefined) return part.structuredContent
  if (part.content !== undefined) return summarizeToolResultContent(part.content)?.text ?? part.content
  return part.output
}

export function buildToolResultDetails(
  part: { output?: unknown; content?: unknown; structuredContent?: unknown },
  labels: {
    structuredContent: string
    content: string
    output: string
    fallback: string
  }
): AgentRuntimeMessagePartDetail[] | undefined {
  const details = [
    buildDetail(labels.structuredContent, part.structuredContent, labels.fallback),
    buildContentDetail(labels.content, part.content, labels.fallback),
    buildDetail(labels.output, part.output, labels.fallback)
  ].filter((detail): detail is AgentRuntimeMessagePartDetail => detail !== null)

  const deduped = dedupeDetails(details)
  return deduped.length > 1 || deduped.some((detail) => detail.items?.length) ? deduped : undefined
}

export function summarizeMessagePartValue(value: unknown, fallback: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return truncateMessagePartText(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  try {
    return truncateMessagePartText(JSON.stringify(value, null, 2))
  } catch {
    return fallback
  }
}

function buildDetail(label: string, value: unknown, fallback: string): AgentRuntimeMessagePartDetail | null {
  const text = summarizeMessagePartValue(value, fallback)
  return text ? { label, text } : null
}

function buildContentDetail(label: string, value: unknown, fallback: string): AgentRuntimeMessagePartDetail | null {
  const content = summarizeToolResultContent(value)
  if (content) return { label, text: content.text, items: content.items }
  return buildDetail(label, value, fallback)
}

function dedupeDetails(details: AgentRuntimeMessagePartDetail[]): AgentRuntimeMessagePartDetail[] {
  const seen = new Set<string>()
  return details.filter((detail) => {
    if (seen.has(detail.text)) return false
    seen.add(detail.text)
    return true
  })
}

function truncateMessagePartText(value: string): string {
  const normalized = value.trim()
  if (normalized.length <= 800) return normalized
  return `${normalized.slice(0, 800)}...`
}

function summarizeToolResultContent(
  value: unknown,
  fallback = ''
): { text: string; items: AgentRuntimeMessagePartDetailItem[] } | null {
  if (!Array.isArray(value)) return null

  const items = value
    .map((block) => summarizeToolResultContentBlock(block, fallback))
    .filter((item): item is AgentRuntimeMessagePartDetailItem => item !== null)
  if (items.length === 0) return null

  return {
    text: truncateMessagePartText(items.map(formatToolResultContentItemText).join('\n')),
    items
  }
}

function summarizeToolResultContentBlock(block: unknown, fallback: string): AgentRuntimeMessagePartDetailItem | null {
  if (!isPlainRecord(block)) {
    return {
      kind: 'json',
      title: 'value',
      text: summarizeMessagePartValue(block, fallback) ?? undefined
    }
  }

  const type = typeof block.type === 'string' && block.type ? block.type : 'content'
  if (type === 'text' && typeof block.text === 'string') {
    return { kind: 'text', title: type, text: truncateMessagePartText(block.text) }
  }

  if (type === 'image') {
    const mimeType = readString(block.mimeType)
    const data = readString(block.data)
    const previewUrl = buildImageDataUrl(mimeType, data)
    return {
      kind: 'media',
      title: type,
      meta: compactJoin([mimeType, formatBase64Size(data)]),
      ...(previewUrl
        ? {
            previewUrl,
            openTarget: previewUrl,
            openTargetKind: 'external' as const
          }
        : {})
    }
  }

  if (type === 'resource' && isPlainRecord(block.resource)) {
    const resourceUri = readString(block.resource.uri)
    const resourceOpenTarget = resolveResourceOpenTarget(resourceUri)
    return {
      kind: 'resource',
      title: type,
      meta: resourceUri,
      text: typeof block.resource.text === 'string' ? truncateMessagePartText(block.resource.text) : undefined,
      ...(resourceOpenTarget ?? {})
    }
  }

  return {
    kind: 'json',
    title: type,
    text: summarizeMessagePartValue(block, fallback) ?? undefined
  }
}

function formatToolResultContentItemText(item: AgentRuntimeMessagePartDetailItem): string {
  if (item.kind === 'text') return item.text ?? ''

  const header = compactJoin([`[${item.title}]`, item.meta], ' ')
  return compactJoin([header, item.text], '\n') ?? ''
}

function formatBase64Size(value: string | undefined): string | undefined {
  if (!value) return undefined

  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  const size = Math.max(0, Math.floor((value.length * 3) / 4) - padding)
  return `${size} B`
}

function compactJoin(values: Array<string | undefined>, separator = ', '): string | undefined {
  const compacted = values.filter((value): value is string => Boolean(value))
  return compacted.length ? compacted.join(separator) : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function buildImageDataUrl(mimeType: string | undefined, data: string | undefined): string | undefined {
  if (!mimeType || !data) return undefined
  return `data:${mimeType};base64,${data}`
}

function resolveResourceOpenTarget(
  resourceUri: string | undefined
): Pick<AgentRuntimeMessagePartDetailItem, 'openTarget' | 'openTargetKind'> | undefined {
  if (!resourceUri) return undefined

  if (resourceUri.startsWith('file://')) {
    const path = readFileUriPath(resourceUri)
    if (path) return { openTarget: path, openTargetKind: 'path' }
  }

  return { openTarget: resourceUri, openTargetKind: 'external' }
}

function readFileUriPath(resourceUri: string): string | undefined {
  try {
    const parsed = new URL(resourceUri)
    if (parsed.protocol !== 'file:') return undefined

    const pathname = decodeURIComponent(parsed.pathname)
    if (!pathname) return undefined
    if (parsed.host) return `//${parsed.host}${pathname}`
    if (/^\/[A-Za-z]:\//.test(pathname)) return pathname.slice(1)
    return pathname
  } catch {
    return undefined
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
