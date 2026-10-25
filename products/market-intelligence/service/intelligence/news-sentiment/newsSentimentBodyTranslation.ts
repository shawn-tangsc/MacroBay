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
  | { state: 'translated'; body: string; cached: boolean }
  | { state: 'off' | 'unavailable' | 'failed'; errorCode?: string }

export type NewsSentimentBodyTranslation = ReturnType<typeof createNewsSentimentBodyTranslationService>

export function createNewsSentimentBodyTranslationService(deps: {
  store: Pick<NewsSentimentStore, 'getDocument' | 'getBodyTranslation' | 'upsertBodyTranslation'>
  invoke: StructuredModelInvocationService['invoke']
  readSettings: () => Promise<{ settings: IntelligenceTranslationSettings; targetLocale: IntelligenceTranslationTargetLocale }>
  getProviderState?: () => Promise<ProviderState>
  getModelDefaults?: () => Promise<ModelDefaultsSettings>
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
    get(itemId: string): NewsBodyTranslationRecord | undefined {
      const { record, body, hash } = cached(itemId)
      return record && body && record.bodyHash === hash ? record : undefined
    },

    status(itemId: string): 'translated' | 'failed' | 'missing' {
      const { record, hash } = cached(itemId)
      if (!record || record.bodyHash !== hash) return 'missing'
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
      if (!options.force && existing?.state === 'translated' && existing.bodyHash === hash && existing.targetLocale === targetLocale && existing.bodyText) {
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
        itemId, bodyHash: hash, targetLocale, state: 'translated', bodyText,
        providerId: model.providerId, modelId: model.modelId, translatedAt: deps.now()
      })
      return { state: 'translated', body: bodyText, cached: false }
    }
  }
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
