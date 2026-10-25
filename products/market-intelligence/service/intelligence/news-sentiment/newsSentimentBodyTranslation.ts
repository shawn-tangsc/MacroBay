import { createHash } from 'node:crypto'

import type { StructuredModelInvocationService } from '@platform/ai/invocation/structuredModelInvocation'
import type { ProviderState } from '@platform/ai/providers/modelProviderTypes'
import type { ModelDefaultsSettings } from '@platform/settings/schema/appSettings'

import type { IntelligenceTranslationSettings, IntelligenceTranslationTargetLocale } from '../schema/intelligenceTranslation'
import type { NewsBodyTranslationRecord } from '../schema/newsSentiment'
import { resolveTranslationModel } from '../application/intelligenceTranslationModel'
import type { NewsSentimentStore } from './newsSentimentStore'

const CHUNK_CHARS = 2_000
const MIN_BODY_CHARS = 200

export type BodyTranslationResult =
  | { state: 'translated'; body: string; title?: string; cached: boolean }
  | { state: 'off' | 'unavailable' | 'failed'; errorCode?: string }

export type NewsSentimentBodyTranslation = ReturnType<typeof createNewsSentimentBodyTranslationService>

export function createNewsSentimentBodyTranslationService(deps: {
  store: Pick<NewsSentimentStore, 'getDocument' | 'getBodyTranslation' | 'upsertBodyTranslation'>
  invoke: StructuredModelInvocationService['invoke']
  readSettings: () => Promise<{ settings: IntelligenceTranslationSettings; targetLocale: IntelligenceTranslationTargetLocale }>
  getProviderState?: () => Promise<ProviderState>
  getModelDefaults?: () => Promise<ModelDefaultsSettings>
  getTitle?: (itemId: string) => string | undefined
  now: () => string
}) {
  function bodyHash(body: string): string {
    return createHash('sha256').update(body).digest('hex')
  }

  function cached(itemId: string): { record?: NewsBodyTranslationRecord; body?: string; hash?: string } {
    const document = deps.store.getDocument(itemId)
    const body = document?.state === 'available' ? document.bodyText : undefined
    if (!body || body.length < MIN_BODY_CHARS) return {}
    const hash = bodyHash(body)
    const record = deps.store.getBodyTranslation(itemId)
    if (record?.state === 'translated' && record.bodyHash === hash && record.bodyText) {
      return { record, body: record.bodyText, hash }
    }
    return { record, hash }
  }

  return {
    get(itemId: string, targetLocale?: string): NewsBodyTranslationRecord | undefined {
      const { record, body, hash } = cached(itemId)
      if (!record || !body || record.bodyHash !== hash) return undefined
      if (targetLocale && record.targetLocale !== targetLocale) return undefined
      return record
    },

    status(itemId: string, targetLocale?: string): 'translated' | 'failed' | 'missing' {
      const { record, hash } = cached(itemId)
      if (!record || record.bodyHash !== hash) return 'missing'
      if (targetLocale && record.targetLocale !== targetLocale) return 'missing'
      return record.state
    },

    async translate(itemId: string, options: { manual?: boolean; force?: boolean } = {}): Promise<BodyTranslationResult> {
      const { settings, targetLocale } = await deps.readSettings()
      // Manual drawer actions run even when auto translation is off; only an explicit body switch off
      // plus the auto flag can suppress the background path.
      if (!options.manual && (!settings.autoTranslateEnabled || settings.translateBody === false)) return { state: 'off' }
      const document = deps.store.getDocument(itemId)
      const body = document?.state === 'available' ? document.bodyText : undefined
      if (!body || body.length < MIN_BODY_CHARS) return { state: 'unavailable' }
      const hash = bodyHash(body)
      const existing = deps.store.getBodyTranslation(itemId)
      if (!options.force && existing?.state === 'translated' && existing.bodyHash === hash && existing.targetLocale === targetLocale && existing.bodyText && existing.titleText) {
        return { state: 'translated', body: existing.bodyText, cached: true }
      }

      const [providers, modelDefaults] = await Promise.all([
        deps.getProviderState?.().catch(() => undefined) ?? Promise.resolve(undefined),
        deps.getModelDefaults?.().catch(() => undefined) ?? Promise.resolve(undefined)
      ])
      const model = resolveTranslationModel({ settings, modelDefaults: modelDefaults ?? null, providers: providers?.providers ?? [] })
      if (!model.providerId || !model.modelId) {
        deps.store.upsertBodyTranslation({ itemId, bodyHash: hash, targetLocale, state: 'failed', errorCode: 'model-unavailable', translatedAt: deps.now() })
        return { state: 'failed', errorCode: 'model-unavailable' }
      }

      const title = await translateTitle(deps.invoke, model.providerId, model.modelId, itemId, deps.getTitle?.(itemId), targetLocale)
      const chunks = splitBody(body)
      const translated: string[] = []
      for (const [index, chunk] of chunks.entries()) {
        const result = await deps.invoke({
          taskId: `market-intelligence.body-translation:${itemId}:${index}`,
          providerId: model.providerId,
          modelId: model.modelId,
          messages: [
            { role: 'system', content: `Translate the article body into ${targetLocale}. Preserve symbols, organization names, numbers, percentages and dates. Return JSON only with key body.` },
            { role: 'user', content: JSON.stringify({ body: chunk }) }
          ],
          parse: (value: unknown) => ({
            body: typeof (value as Record<string, unknown>)?.body === 'string' ? String((value as Record<string, unknown>).body) : ''
          })
        })
        if (result.ok && result.output.body) translated.push(result.output.body)
      }

      if (translated.length === 0) {
        deps.store.upsertBodyTranslation({ itemId, bodyHash: hash, targetLocale, state: 'failed', providerId: model.providerId, modelId: model.modelId, errorCode: 'provider-error', translatedAt: deps.now() })
        return { state: 'failed', errorCode: 'provider-error' }
      }
      const bodyText = translated.join('\n\n')
      deps.store.upsertBodyTranslation({
        itemId, bodyHash: hash, targetLocale, state: 'translated', ...(title ? { titleText: title } : {}), bodyText,
        providerId: model.providerId, modelId: model.modelId, translatedAt: deps.now()
      })
      return { state: 'translated', body: bodyText, ...(title ? { title } : {}), cached: false }
    }
  }
}


async function translateTitle(
  invoke: StructuredModelInvocationService['invoke'],
  providerId: string,
  modelId: string,
  itemId: string,
  title: string | undefined,
  targetLocale: string
): Promise<string | undefined> {
  if (!title) return undefined
  const result = await invoke({
    taskId: `market-intelligence.body-translation:${itemId}:title`,
    providerId,
    modelId,
    messages: [
      { role: 'system', content: `Translate this news headline into ${targetLocale}. Preserve names, tickers, numbers and dates. Return JSON only with key title.` },
      { role: 'user', content: JSON.stringify({ title }) }
    ],
    parse: (value: unknown) => ({
      title: typeof (value as Record<string, unknown>)?.title === 'string' ? String((value as Record<string, unknown>).title) : ''
    })
  })
  return result.ok && result.output.title ? result.output.title : undefined
}

function splitBody(body: string): string[] {
  const chunks: string[] = []
  let rest = body
  while (rest.length > 0 && chunks.length < 8) {
    if (rest.length <= CHUNK_CHARS) { chunks.push(rest); break }
    const cut = rest.lastIndexOf('\n\n', CHUNK_CHARS)
    const end = cut > 400 ? cut : CHUNK_CHARS
    chunks.push(rest.slice(0, end))
    rest = rest.slice(end).replace(/^\s+/, '')
  }
  return chunks
}
