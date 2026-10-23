import type { TranslationModelOutput } from '../schema/intelligenceTranslation'

export function buildTranslationSystemPrompt(): string {
  return [
    'You translate financial and crypto intelligence text.',
    'Preserve symbols, trading pairs, organization names, product names, API names, URLs, amounts, percentages, and dates.',
    'Do not add interpretation absent from the source.',
    'Keep severity, uncertainty, and negation faithful to the source.',
    'Return JSON only with keys: title, summary, body, notes.',
    'Do not include trading advice.'
  ].join(' ')
}

export function buildTranslationUserPrompt(input: {
  sourceLanguage: string
  title: string
  summary?: string
  body?: string
}): string {
  return JSON.stringify({
    sourceLanguage: input.sourceLanguage,
    title: input.title,
    summary: input.summary ?? '',
    body: input.body ?? ''
  })
}

export function parseTranslationModelOutput(value: unknown): TranslationModelOutput {
  if (!value || typeof value !== 'object') {
    throw new Error('Translation output was not an object.')
  }

  const record = value as Record<string, unknown>
  const notes = Array.isArray(record.notes)
    ? record.notes.filter((entry): entry is string => typeof entry === 'string')
    : undefined

  return {
    title: typeof record.title === 'string' ? record.title : undefined,
    summary: typeof record.summary === 'string' ? record.summary : undefined,
    body: typeof record.body === 'string' ? record.body : undefined,
    notes
  }
}
