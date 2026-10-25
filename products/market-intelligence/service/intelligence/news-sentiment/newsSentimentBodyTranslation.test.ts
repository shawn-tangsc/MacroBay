import { describe, expect, it, vi } from 'vitest'

import { createNewsSentimentSqliteStore } from './newsSentimentStore'
import { createNewsSentimentBodyTranslationService } from './newsSentimentBodyTranslation'

const BODY = 'The SEC approved options on spot Ether ETFs after a long review. '.repeat(20)

function harness() {
  const store = createNewsSentimentSqliteStore(':memory:')
  store.upsertDocument({
    itemId: 'item-a', sourceId: 'coindesk-rss', url: 'https://example.com/a', fetchedAt: '2026-10-25T00:00:00.000Z',
    bodyText: BODY, bodyChars: BODY.length, state: 'available'
  })
  const invoke = vi.fn(async (input: { taskId?: string }) => ({ ok: true as const, output: input.taskId?.endsWith(':title') ? { title: '美国证券交易委员会批准现货以太坊 ETF 期权' } : { body: '美国证券交易委员会批准了现货以太坊 ETF 期权。' }, providerId: 'p', modelId: 'm', trace: { taskId: 't', durationMs: 1 } }))
  const service = createNewsSentimentBodyTranslationService({
    store,
    invoke: invoke as never,
    readSettings: async () => ({ settings: { autoTranslateEnabled: true, translateBody: true, targetLocale: 'follow-app', providerId: 'p', modelId: 'm', translateTitle: true, translateSummary: true, translateEvidenceExcerpt: true, updatedAt: '2026-10-25T00:00:00.000Z' }, targetLocale: 'zh-CN' }),
    getProviderState: async () => ({ providers: [{ id: 'p', models: [{ id: 'm', capabilities: { chat: true } }] }] }) as never,
    getModelDefaults: async () => ({ translationModelId: 'p:m' }) as never,
    getTitle: () => 'SEC Approves Spot Ethereum ETF Options',
    now: () => '2026-10-25T00:00:00.000Z'
  })
  return { store, invoke, service }
}

describe('newsSentimentBodyTranslation', () => {
  it('translates once and serves the cached body on the next open', async () => {
    const { service, invoke } = harness()
    const first = await service.translate('item-a', { manual: true })
    expect(first).toMatchObject({ state: 'translated', cached: false })
    const second = await service.translate('item-a', { manual: true })
    expect(second).toMatchObject({ state: 'translated', cached: true })
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(service.get('item-a')?.bodyText).toContain('ETF')
  })

  it('does nothing when the user turned body translation off', async () => {
    const { service, invoke } = harness()
    const off = createNewsSentimentBodyTranslationService({
      store: (service as never as { store?: never }) as never ?? (undefined as never),
      invoke: invoke as never,
      readSettings: async () => ({ settings: { autoTranslateEnabled: true, translateBody: false, targetLocale: 'follow-app', providerId: 'p', modelId: 'm', translateTitle: true, translateSummary: true, translateEvidenceExcerpt: true, updatedAt: 'x' }, targetLocale: 'zh-CN' }),
      now: () => 'x'
    })
    expect(await off.translate('item-a')).toEqual({ state: 'off' })
    expect(invoke).not.toHaveBeenCalled()
  })
})
