import type { CreateAssistantDto } from '@platform/ai/assistant-platform/schemas/assistantSchemas'

type AssistantImportRecord = {
  name?: unknown
  emoji?: unknown
  icon?: unknown
  prompt?: unknown
  description?: unknown
  group?: unknown
  tags?: unknown
}

export function parseAssistantImportJson(raw: string): CreateAssistantDto[] {
  const parsed = JSON.parse(raw) as unknown
  const records = Array.isArray(parsed) ? parsed : [parsed]
  return records.map((record, index) => normalizeImportRecord(record as AssistantImportRecord, index))
}

function normalizeImportRecord(record: AssistantImportRecord, index: number): CreateAssistantDto {
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : ''
  if (!name) throw new Error(`Imported assistant ${index + 1} requires a name.`)
  if (!prompt) throw new Error(`Imported assistant ${index + 1} requires a prompt.`)
  const groups = normalizeStringList(record.group)
  const tags = [...groups, ...normalizeStringList(record.tags)]
  return {
    name,
    prompt,
    icon: normalizeIcon(record.emoji) || normalizeIcon(record.icon) || '💬',
    description: typeof record.description === 'string' ? record.description.trim() : '',
    tags: tags.map((tag) => ({ id: slugify(tag), name: tag }))
  }
}

function normalizeIcon(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeStringList(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim())
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'tag'
}
