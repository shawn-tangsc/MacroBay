import { describe, expect, it, vi } from 'vitest'

import type { ProviderState } from '@platform/ai/providers/modelProviderTypes'
import { createDefaultProviderState } from '@platform/ai/providers/providerStore'

import { createNewsSentimentSqliteStore } from './newsSentimentStore'
import { createInMemoryNewsSentimentSettingsStorage, createNewsSentimentSettingsStore } from './newsSentimentSettingsStore'
import { createNewsSentimentScoringService, type NewsSentimentInvoke } from './newsSentimentScoringService'

const BODY =
  'The SEC approved rule changes that clear the way for options on spot Ether ETFs, a step the industry has sought for more than a year.'

function item(overrides: Record<string, unknown> = {}) {
  return {
    itemId: 'item-a',
    sourceId: 'coindesk-rss',
    title: 'SEC Approves Spot Ethereum ETF Options',
    summary: 'The approval clears the way for options on spot Ether ETFs.',
    url: 'https://www.coindesk.com/markets/eth-etf-options',
    publishedAt: '2026-10-24T12:00:00.000Z',
    detectedAt: '2026-10-24T12:01:00.000Z',
    language: 'en',
    ...overrides
  } as never
}

function readyProviders(): { state: ProviderState; providerId: string; modelId: string } {
  const state = createDefaultProviderState()
  const provider = state.providers[0]!
  const model = provider.models.find((entry) => entry.capabilities.chat)!
  provider.enabled = true
  provider.apiKey = 'test-key'
  provider.baseUrl = 'https://example.com/v1'
  return { state, providerId: provider.id, modelId: model.id }
}

function modelOutput() {
  return {
    polarity: 'bullish',
    strength: 4,
    confidence: 78,
    symbols: ['ETH'],
    reasonCode: 'etf-approval',
    evidenceQuote: 'approved rule changes that clear the way for options on spot Ether ETFs',
    caveats: []
  }
}

async function harness(options: { withModel: boolean }) {
  const store = createNewsSentimentSqliteStore(':memory:')
  store.upsertDocument({
    itemId: 'item-a',
    sourceId: 'coindesk-rss',
    url: 'https://www.coindesk.com/x',
    fetchedAt: '2026-10-24T12:05:00.000Z',
    bodyText: BODY,
    bodyChars: BODY.length,
    extractionVersion: 'news-body-v1',
    state: 'available'
  })
  const { state, providerId, modelId } = readyProviders()
  const invoke = vi.fn(async () => ({
    ok: true as const,
    output: modelOutput(),
    providerId,
    modelId,
    trace: { taskId: 't', durationMs: 1 }
  })) as unknown as NewsSentimentInvoke

  const service = createNewsSentimentScoringService({
    pipeline: { listItems: () => [item()] },
    store,
    settingsStore: createNewsSentimentSettingsStore(createInMemoryNewsSentimentSettingsStorage()),
    ...(options.withModel
      ? {
          getProviderState: async () => state,
          getModelDefaults: async () => ({ fastModelId: `${providerId}:${modelId}` })
        }
      : {}),
    invoke,
    now: () => '2026-10-24T13:00:00.000Z'
  })
  return { store, service, invoke }
}

describe('newsSentimentScoringService', () => {
  it('stores a model judgment with its engine version', async () => {
    const { store, service, invoke } = await harness({ withModel: true })
    const result = await service.scoreItems({ itemIds: ['item-a'] })

    expect(result).toMatchObject({ processed: 1, model: 1, rules: 0 })
    expect(invoke).toHaveBeenCalledTimes(1)
    const record = store.getLatestSentiment('item-a', '2026-10-24T13:00:00.000Z')
    expect(record).toMatchObject({
      engine: 'model',
      polarity: 'bullish',
      symbols: ['ETH'],
      promptVersion: 'news-polarity-v1'
    })
    expect(record?.modelRef).toMatch(/.+:.+/)
  })

  it('falls back to rules when the model output fails validation', async () => {
    const { store, service, invoke } = await harness({ withModel: true })
    ;(invoke as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async (request: { parse: (value: unknown) => unknown }) => ({
      ok: true,
      output: request.parse({ polarity: 'not-a-direction' }),
      providerId: 'p',
      modelId: 'm',
      trace: { taskId: 't', durationMs: 1 }
    }))

    const result = await service.scoreItems({ itemIds: ['item-a'] })
    expect(result).toMatchObject({ rules: 1, model: 0 })
    const record = store.getLatestSentiment('item-a', '2026-10-24T13:00:00.000Z')
    expect(record?.engine).toBe('rules')
    expect(record?.ruleId).toBe('news.etf-approval.v1')
    expect(record?.caveats).toContain('news-model-invalid-output')
  })

  it('uses rules without calling a model when no model resolves', async () => {
    const { store, service, invoke } = await harness({ withModel: false })
    const result = await service.scoreItems({ itemIds: ['item-a'] })

    expect(result.rules).toBe(1)
    expect(invoke).not.toHaveBeenCalled()
    const record = store.getLatestSentiment('item-a', '2026-10-24T13:00:00.000Z')
    expect(record?.caveats).toContain('news-model-unavailable')
  })

  it('skips OKX campaign announcements outside the three admitted types', async () => {
    const store = createNewsSentimentSqliteStore(':memory:')
    const invoke = vi.fn()
    const service = createNewsSentimentScoringService({
      pipeline: {
        listItems: () => [item({ sourceId: 'okx-latest-announcements', summary: 'announcements-p2p-trading' })]
      },
      store,
      settingsStore: createNewsSentimentSettingsStore(createInMemoryNewsSentimentSettingsStorage()),
      invoke: invoke as unknown as NewsSentimentInvoke,
      now: () => '2026-10-24T13:00:00.000Z'
    })

    const result = await service.scoreItems({ itemIds: ['item-a'] })
    expect(result.skipped).toBe(1)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('does not rescore an item already judged by the same engine version', async () => {
    const { service, invoke } = await harness({ withModel: true })
    await service.scoreItems({ itemIds: ['item-a'] })
    const second = await service.scoreItems({ itemIds: ['item-a'] })

    expect(second.skipped).toBe(1)
    expect(invoke).toHaveBeenCalledTimes(1)
  })
})
