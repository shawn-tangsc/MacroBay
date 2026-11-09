import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import type { ProviderState } from '@platform/ai/providers/modelProviderTypes'
import type {
  NotificationSubmitOutcome,
  NotificationSubmitRequest
} from '@platform/notifications/contracts/notificationContracts'
import { createDefaultProviderState } from '@platform/ai/providers/providerStore'

import { NEWS_SENTIMENT_PROMPT_VERSION } from '../schema/newsSentiment'
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

async function harness(options: {
  withModel: boolean
  items?: unknown[]
  output?: () => Record<string, unknown>
  alertLedger?: string
  submitAlert?: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>
}) {
  const store = createNewsSentimentSqliteStore(':memory:')
  store.upsertDocument({
    itemId: 'item-a',
    sourceId: 'coindesk-rss',
    url: 'https://www.coindesk.com/x',
    fetchedAt: '2026-10-24T12:05:00.000Z',
    bodyText: BODY,
    bodyChars: BODY.length,
    state: 'available'
  })
  const { state, providerId, modelId } = readyProviders()
  const invoke = vi.fn(async () => ({
    ok: true as const,
    output: options.output?.() ?? modelOutput(),
    providerId,
    modelId,
    trace: { taskId: 't', durationMs: 1 }
  })) as unknown as NewsSentimentInvoke

  const service = createNewsSentimentScoringService({
    pipeline: { listItems: () => (options.items ?? [item()]) as never[] },
    store,
    settingsStore: createNewsSentimentSettingsStore(createInMemoryNewsSentimentSettingsStorage()),
    ...(options.withModel
      ? {
          getProviderState: async () => state,
          getModelDefaults: async () => ({
            assistantModelId: '',
            agentModelId: '',
            fastModelId: `${providerId}:${modelId}`,
            translationModelId: '',
            imageModelId: ''
          })
        }
      : {}),
    invoke,
    now: () => '2026-10-24T13:00:00.000Z',
    ...(options.alertLedger
      ? {
          alertDelivery: {
            ledgerPath: options.alertLedger,
            submit:
              options.submitAlert ??
              (async (): Promise<NotificationSubmitOutcome> => ({ kind: 'accepted', recordId: 'r', levels: ['center'], suppressedLevels: [] }))
          }
        }
      : {})
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
      // 版本号从常量取：提示词升版时这条断言不该跟着红，它验的是「记录写了版本」。
      promptVersion: NEWS_SENTIMENT_PROMPT_VERSION
    })
    expect(record?.modelRef).toMatch(/.+:.+/)
  })

  it('gives two reports of one event one story key and stores entities and why', async () => {
    // 名字已是规范化形态：规范化由 `parseNewsSentimentEntities` 负责，这里验的是接线。
    const entities = [
      { name: 'democrats', kind: 'org' },
      { name: 'us midterm elections', kind: 'event' },
      { name: 'bitcoin', kind: 'asset' }
    ]
    const { store, service } = await harness({
      withModel: true,
      items: [
        item({ itemId: 'item-a', publishedAt: '2026-10-24T04:55:00.000Z', title: 'Democrats surge toward Senate and House majorities' }),
        item({ itemId: 'item-b', publishedAt: '2026-10-24T10:38:00.000Z', title: 'Analysts react to the new blue Congress' })
      ],
      output: () => ({ ...modelOutput(), entities, why: '选举结果改变监管预期。' })
    })

    await expect(service.scoreItems({})).resolves.toMatchObject({ processed: 2, model: 2 })
    const first = store.getLatestSentiment('item-a', '2026-10-24T13:00:00.000Z')
    const second = store.getLatestSentiment('item-b', '2026-10-24T13:00:00.000Z')
    // 一轮按最新优先：较晚发布那条先评出来、先拿到键；较早那条随后并入它。
    // 键只锚在「第一个拿到键的报道」上，同一件事因此只有一个键。
    expect(second?.storyKey).toBe('story:2026-10-24:item-b')
    expect(first?.storyKey).toBe('story:2026-10-24:item-b')
    expect(second?.entities?.map((entity) => entity.name).sort()).toEqual([
      'bitcoin',
      'democrats',
      'us midterm elections'
    ])
    expect(second?.why).toBe('选举结果改变监管预期。')
  })

  it('sends nothing while the outlet is not switched on, and a submission failure does not fail the pass', async () => {
    const submitAlert = vi.fn(async () => {
      throw new Error('notification runtime is down')
    })
    const { store, service } = await harness({ withModel: true, alertLedger: ':memory:', submitAlert })
    await expect(service.scoreItems({ itemIds: ['item-a'] })).resolves.toMatchObject({ processed: 1 })
    // 开关默认关（账本里没有水位）：判定点跑过，但一条都没提交。
    expect(submitAlert).not.toHaveBeenCalled()
    expect(store.getLatestSentiment('item-a', '2026-10-24T13:00:00.000Z')).toBeDefined()
  })

  it('leaves a rules-scored item without a story key, so it can never be pushed', async () => {
    const { store, service } = await harness({ withModel: false })
    await service.scoreItems({ itemIds: ['item-a'] })
    const record = store.getLatestSentiment('item-a', '2026-10-24T13:00:00.000Z')
    expect(record?.engine).toBe('rules')
    expect(record?.storyKey).toBeUndefined()
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

describe('newsSentimentScoringService budget, retry and fallback', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f']

  function makeService(invoke: NewsSentimentInvoke, count: number) {
    const store = createNewsSentimentSqliteStore(':memory:')
    const { state, providerId, modelId } = readyProviders()
    const items = ids.slice(0, count).map((id, index) => item({ itemId: `item-${id}`, title: `News ${id}`, publishedAt: `2026-10-24T12:${String(index).padStart(2, '0')}:00.000Z` }))
    const service = createNewsSentimentScoringService({
      pipeline: { listItems: () => items },
      store,
      settingsStore: createNewsSentimentSettingsStore(createInMemoryNewsSentimentSettingsStorage()),
      getProviderState: async () => state,
      getModelDefaults: async () => ({
        assistantModelId: '',
        agentModelId: '',
        fastModelId: `${providerId}:${modelId}`,
        translationModelId: '',
        imageModelId: ''
      }),
      invoke,
      now: () => '2026-10-24T13:00:00.000Z'
    })
    return { store, service }
  }

  const failing = () => vi.fn(async () => { throw new Error('provider down') }) as unknown as NewsSentimentInvoke

  it('retries a failed call once, so one hiccup does not become a rule judgment', async () => {
    const { providerId, modelId } = readyProviders()
    let calls = 0
    const invoke = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new Error('provider down')
      return { ok: true as const, output: modelOutput(), providerId, modelId, trace: { taskId: 't', durationMs: 1 } }
    }) as unknown as NewsSentimentInvoke
    const { service, store } = makeService(invoke, 1)

    const result = await service.scoreItems({ itemIds: ['item-a'] })
    expect(result).toMatchObject({ model: 1, rules: 0, modelCalls: 2 })
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(store.getLatestSentiment('item-a', '2026-10-24T13:00:00.000Z')?.engine).toBe('model')
  })

  it('does not retry an invalid output: the model already answered', async () => {
    const invoke = vi.fn(async (request: { parse: (value: unknown) => unknown }) => ({
      ok: true as const,
      output: request.parse({ polarity: 'sideways' }),
      providerId: 'p', modelId: 'm', trace: { taskId: 't', durationMs: 1 }
    })) as unknown as NewsSentimentInvoke
    const { service, store } = makeService(invoke, 1)

    const result = await service.scoreItems({ itemIds: ['item-a'] })
    expect(result).toMatchObject({ model: 0, rules: 1, modelCalls: 1 })
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(store.getLatestSentiment('item-a', '2026-10-24T13:00:00.000Z')?.caveats).toContain('news-model-invalid-output')
  })

  it('stops calling the model after three consecutive failures', async () => {
    const invoke = failing()
    const { service, store } = makeService(invoke, 6)

    const result = await service.scoreItems({ limit: 10 })
    // Three items x (call + retry), then the rest go straight to rules.
    expect(invoke).toHaveBeenCalledTimes(6)
    expect(result).toMatchObject({ model: 0, rules: 6, modelCalls: 6 })
    // The pass is ordered newest-first, so the last three items are the degraded ones, whichever
    // ids they happen to be.
    const degraded = ids.filter((id) => store.getLatestSentiment(`item-${id}`, '2026-10-24T13:00:00.000Z')?.caveats.includes('news-model-degraded'))
    expect(degraded).toHaveLength(3)
  })

  it('spends retries from the same pass allowance instead of a second counter', async () => {
    const invoke = failing()
    const { service, store } = makeService(invoke, 3)

    const result = await service.scoreItems({ limit: 3 })
    expect(result).toMatchObject({ model: 0, rules: 3, modelCalls: 3 })
    expect(invoke).toHaveBeenCalledTimes(3)
    // The pass ran out mid-item; the remaining judgments say why they have no model answer.
    const exhausted = ids.filter((id) => store.getLatestSentiment(`item-${id}`, '2026-10-24T13:00:00.000Z')?.caveats.includes('news-model-budget-exhausted'))
    expect(exhausted.length).toBeGreaterThan(0)
  })
})

describe('the scoring service exposes the push threshold it judges with', () => {
  function serviceWithThresholdFile(thresholdFilePath: string) {
    return createNewsSentimentScoringService({
      pipeline: { listItems: () => [item()] },
      store: createNewsSentimentSqliteStore(':memory:'),
      settingsStore: createNewsSentimentSettingsStore(createInMemoryNewsSentimentSettingsStorage()),
      invoke: vi.fn() as unknown as NewsSentimentInvoke,
      now: () => '2026-10-24T13:00:00.000Z',
      alertDelivery: {
        ledgerPath: join(mkdtempSync(join(tmpdir(), 'news-ledger-')), 'ledger.sqlite'),
        thresholdFilePath,
        submit: async (): Promise<NotificationSubmitOutcome> => ({ kind: 'accepted', recordId: 'r', levels: ['center'], suppressedLevels: [] })
      }
    })
  }

  it('reads the same instance the alert gate reads, so a saved threshold shows up at once', () => {
    const thresholdFilePath = join(mkdtempSync(join(tmpdir(), 'news-threshold-')), 'threshold.json')
    const service = serviceWithThresholdFile(thresholdFilePath)
    // 文件还不存在：与判定同一个缺省（中），不是另编一个值。
    expect(service.readPushThreshold()).toBe('medium')
    service.pushThreshold!.write({ pushThreshold: 'low' })
    expect(service.readPushThreshold()).toBe('low')
  })

  it('falls back to the gate’s default when no threshold storage is wired', () => {
    const service = createNewsSentimentScoringService({
      pipeline: { listItems: () => [item()] },
      store: createNewsSentimentSqliteStore(':memory:'),
      settingsStore: createNewsSentimentSettingsStore(createInMemoryNewsSentimentSettingsStorage()),
      invoke: vi.fn() as unknown as NewsSentimentInvoke,
      now: () => '2026-10-24T13:00:00.000Z'
    })
    expect(service.readPushThreshold()).toBe('medium')
    expect(service.pushThreshold).toBeUndefined()
  })
})
