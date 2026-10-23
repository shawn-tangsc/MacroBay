import type { AgentRuntimeResultPreviewCard, AgentRuntimeResultPreviewLabels } from './agentRuntimeResultPreview'

export const MAX_TABLE_ROWS = 8
export const MAX_TABLE_COLUMNS = 6
export const MAX_PREVIEW_TEXT = 800

export function buildContentBlockCard(
  block: unknown,
  index: number,
  labels: AgentRuntimeResultPreviewLabels,
  fallback: string
): AgentRuntimeResultPreviewCard | null {
  if (!isPlainRecord(block)) {
    const text = summarizeValue(block, fallback)
    return text
      ? {
          key: `content:${index}`,
          kind: 'json',
          title: labels.json,
          text
        }
      : null
  }

  const type = typeof block.type === 'string' && block.type ? block.type : 'content'
  if (type === 'text' && typeof block.text === 'string') {
    return {
      key: `content:${index}`,
      kind: 'text',
      title: labels.text,
      text: truncateText(block.text)
    }
  }

  if (type === 'image') {
    const mimeType = readString(block.mimeType)
    const data = readString(block.data)
    const previewUrl = buildImageDataUrl(mimeType, data)
    return {
      key: `content:${index}`,
      kind: 'image',
      title: labels.image,
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
      key: `content:${index}`,
      kind: 'resource',
      title: labels.resource,
      meta: resourceUri,
      text: typeof block.resource.text === 'string' ? truncateText(block.resource.text) : undefined,
      ...(resourceOpenTarget ?? {})
    }
  }

  const text = summarizeValue(block, fallback)
  return text
    ? {
        key: `content:${index}`,
        kind: 'json',
        title: labels.json,
        text
      }
    : null
}

export function buildTableCard(
  value: unknown,
  keyPrefix: string,
  title: string
): AgentRuntimeResultPreviewCard | null {
  const table = detectTable(value)
  if (!table) return null
  return {
    key: `${keyPrefix}:table`,
    kind: 'table',
    title,
    meta: `${table.rows.length}×${table.columns.length}`,
    table
  }
}

export function buildJsonOrTextCard(
  value: unknown,
  keyPrefix: string,
  labels: AgentRuntimeResultPreviewLabels,
  fallback: string
): AgentRuntimeResultPreviewCard | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    return {
      key: `${keyPrefix}:text`,
      kind: 'text',
      title: labels.text,
      text: truncateText(value)
    }
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return {
      key: `${keyPrefix}:text`,
      kind: 'text',
      title: labels.text,
      text: String(value)
    }
  }

  const text = summarizeValue(value, fallback)
  return text
    ? {
        key: `${keyPrefix}:json`,
        kind: 'json',
        title: labels.json,
        text
      }
    : null
}

function detectTable(value: unknown): { columns: string[]; rows: string[][] } | null {
  if (!Array.isArray(value) || value.length === 0) return null
  if (!value.every(isPlainRecord)) return null

  const columns = uniqueColumns(value).slice(0, MAX_TABLE_COLUMNS)
  if (columns.length < 2) return null

  const rows = value.slice(0, MAX_TABLE_ROWS).map((row) =>
    columns.map((column) => {
      const cell = row[column]
      if (cell === null || cell === undefined) return ''
      if (typeof cell === 'string' || typeof cell === 'number' || typeof cell === 'boolean') return String(cell)
      try {
        return JSON.stringify(cell)
      } catch {
        return ''
      }
    })
  )

  return { columns, rows }
}

function uniqueColumns(rows: Record<string, unknown>[]): string[] {
  const columns: string[] = []
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key)
    }
  }
  return columns
}

export function summarizeValue(value: unknown, fallback: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return truncateText(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return truncateText(JSON.stringify(value, null, 2))
  } catch {
    return fallback
  }
}

function truncateText(value: string): string {
  const normalized = value.trim()
  if (normalized.length <= MAX_PREVIEW_TEXT) return normalized
  return `${normalized.slice(0, MAX_PREVIEW_TEXT)}...`
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
): Pick<AgentRuntimeResultPreviewCard, 'openTarget' | 'openTargetKind'> | undefined {
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
