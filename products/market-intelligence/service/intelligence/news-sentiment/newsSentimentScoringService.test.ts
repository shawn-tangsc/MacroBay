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
  /** 「新抓到的舆情」桌面提醒的提交点（与阈值推送共用同一个平台入口，但断言分开看）。 */
  submitNotice?: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>
  timeZone?: string
  /** 传进来就复用同一个库：用来验「同一条第二次判定」这类跨两轮的行为。 */
  store?: ReturnType<typeof createNewsSentimentSqliteStore>
  /** 第二轮的「现在」要往后挪：判定表按 (item_id, scored_at) 唯一。 */
  now?: string
}) {
  const store = options.store ?? createNewsSentimentSqliteStore(':memory:')
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
    now: () => options.now ?? '2026-10-24T13:00:00.000Z',
    ...(options.alertLedger || options.submitNotice
      ? {
          notificationDelivery: {
            ledgerPath: options.alertLedger ?? ':memory:',
            submit:
              options.submitAlert ??
              options.submitNotice ??
              (async (): Promise<NotificationSubmitOutcome> => ({ kind: 'accepted', recordId: 'r', levels: ['center'], suppressedLevels: [] })),
            timeZone: () => options.timeZone ?? 'Asia/Shanghai'
          }
        }
      : {})
  })
  return { store, service, invoke, modelRef: `${providerId}:${modelId}` }
}

describe('newsSentimentScoringService', () => {
  it('scores every admitted item and hands back no analysis-trigger candidates', async () => {
    // 事故样本那一类：中性、无标的的新闻照样会被判断（那是对的），但不该因此触发一次分析。
    const { service } = await harness({
      withModel: false,
      items: [
        item({ itemId: 'item-a' }),
        item({
          itemId: 'item-b',
          title: 'JPMorgan and DBS complete cross-border payment trial',
          summary: 'The banks said the tokenised deposit pilot carries no direct crypto market impact.',
          publishedAt: '2026-10-24T11:00:00.000Z'
        })
      ]
    })
    const result = await service.scoreItems({})

    expect(result).toMatchObject({ processed: 2, rules: 2 })
    // R39：新闻解读只由读者手动发起。评分结果不再携带触发候选——放回去就是自动分析的入口。
    expect(result).not.toHaveProperty('triggerCandidates')
  })

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

  it('sends no threshold alert while the outlet is not switched on, and a submission failure does not fail the pass', async () => {
    const submitAlert = vi.fn(async (_request: NotificationSubmitRequest) => {
      throw new Error('notification runtime is down')
    })
    const { store, service } = await harness({ withModel: true, alertLedger: ':memory:', submitAlert })
    await expect(service.scoreItems({ itemIds: ['item-a'] })).resolves.toMatchObject({ processed: 1 })
    // 开关默认关（账本里没有水位）：**阈值推送**一条都没提交。桌面提醒是另一条事件，由它自己的
    // 到达判据决定（R40），这里只钉阈值那一条不会因为开关没开就发出去。
    const alertCalls = submitAlert.mock.calls.filter((call) => call[0].eventTypeId === 'market-intelligence.sentiment.alert')
    expect(alertCalls).toHaveLength(0)
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
      notificationDelivery: {
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

describe('prompt version: stamped on new judgments, and never a reason to re-judge history', () => {
  it('writes news-polarity-v3 on a fresh model judgment', async () => {
    const { service, store } = await harness({ withModel: true })
    await service.scoreItems({ itemIds: ['item-a'] })
    expect(store.getLatestSentiment('item-a', '2026-10-24T13:00:00.000Z')?.promptVersion).toBe('news-polarity-v3')
  })

  it('re-judges nothing when only the prompt version moved: 0 re-judged, 0 model calls, same strength', async () => {
    // 用户 2026-11-18 口径：历史不动、新条目用新尺。升版本不许把 721 条历史变成「待判」——
    // 那要再花 36 轮 × 20 条模型调用把整库刷一遍。
    const { service, store, invoke, modelRef } = await harness({ withModel: true })
    store.upsertSentiment({
      itemId: 'item-a', sourceId: 'coindesk-rss', publishedAt: '2026-10-24T12:00:00.000Z',
      scoredAt: '2026-10-23T09:00:00.000Z', polarity: 'bearish', strength: 4, confidence: 75,
      symbols: ['BTC'], reasonCode: 'old-rule', engine: 'model', modelRef,
      promptVersion: 'news-polarity-v2', caveats: []
    })

    const result = await service.scoreItems({ itemIds: ['item-a'] })

    expect(result.processed).toBe(0)
    expect(result.modelCalls).toBe(0)
    expect(invoke).not.toHaveBeenCalled()
    const row = store.getLatestSentiment('item-a', '2026-10-24T13:00:00.000Z')
    expect(row?.promptVersion).toBe('news-polarity-v2')
    expect(row?.strength).toBe(4)
    expect(row?.polarity).toBe('bearish')
  })

  it('still re-judges when the model behind the judgment changed', async () => {
    // 去掉的只是「提示词版本」这一项；供应商/模型换了仍然要重判（那是另一台模型给的判断）。
    const { service, store, invoke } = await harness({ withModel: true })
    store.upsertSentiment({
      itemId: 'item-a', sourceId: 'coindesk-rss', publishedAt: '2026-10-24T12:00:00.000Z',
      scoredAt: '2026-10-23T09:00:00.000Z', polarity: 'bearish', strength: 4, confidence: 75,
      symbols: ['BTC'], reasonCode: 'old-rule', engine: 'model', modelRef: 'someone-else:old-model',
      promptVersion: 'news-polarity-v2', caveats: []
    })

    const result = await service.scoreItems({ itemIds: ['item-a'] })

    expect(result.processed).toBe(1)
    expect(invoke).toHaveBeenCalledTimes(1)
    const row = store.getLatestSentiment('item-a', '2026-10-24T13:00:00.000Z')
    expect(row?.promptVersion).toBe('news-polarity-v3')
    // 旧行没有被就地改写：按它当时的 asOf 读，仍然是 v2。
    expect(store.getLatestSentiment('item-a', '2026-10-23T10:00:00.000Z')?.promptVersion).toBe('news-polarity-v2')
  })
})

describe('one desktop notice per non-low story that just arrived (R40)', () => {
  const accepted = async (_request: NotificationSubmitRequest): Promise<NotificationSubmitOutcome> =>
    ({ kind: 'accepted', recordId: 'r', levels: ['desktop'], suppressedLevels: [] })

  /** 判据①：非低条目入库 → 桌面恰好一条，且动作与行为一致（这一版不许写「查看这条」）。 */
  it('rings the desktop exactly once for a non-low story, and the action only opens the page', async () => {
    const submitNotice = vi.fn(accepted)
    const { service } = await harness({ withModel: true, submitNotice })

    await service.scoreItems({ itemIds: ['item-a'] })

    expect(submitNotice).toHaveBeenCalledTimes(1)
    const request = submitNotice.mock.calls[0]![0] as NotificationSubmitRequest
    expect(request.eventTypeId).toBe('market-intelligence.news.item-arrived')
    // 标题：来源 · 条目标题（源与主体都在）。
    expect(request.rendered?.['zh-CN']?.title).toContain('·')
    expect(request.rendered?.['zh-CN']?.title).toContain('SEC Approves Spot Ethereum ETF Options')
    // 正文：偏向 · 时间（判定已出，所以不会有「判定中」）。
    expect(request.rendered?.['zh-CN']?.body).toContain('偏多')
    expect(request.rendered?.['zh-CN']?.body).toMatch(/\d{2}-\d{2} \d{2}:\d{2}/u)
    // 动作：只到舆情页，标签是「打开舆情」——写了「查看这条」就是撒谎（判据⑤）。
    expect(request.actions).toHaveLength(1)
    expect(request.actions[0]?.id).toBe('open-sentiment')
    expect(request.actions[0]?.kind).toBe('open')
    expect(request.actions[0]?.labelRef).toMatchObject({ scope: 'product', key: 'notification.action.market-intelligence.open-sentiment' })
    expect(JSON.stringify(request.rendered)).not.toContain('查看这条')
    expect(JSON.stringify(request.rendered)).not.toContain('View this')
  })

  it('stays silent for the whole low tier: strength 1', async () => {
    const submitNotice = vi.fn(accepted)
    const { service } = await harness({
      withModel: false,
      submitNotice,
      items: [item({ title: 'Weekly recap: a quiet weekend in crypto markets', summary: 'Nothing moved much.' })]
    })

    const result = await service.scoreItems({ itemIds: ['item-a'] })

    expect(result.processed).toBe(1)
    expect(submitNotice).not.toHaveBeenCalled()
  })

  it('stays silent for the low-tier boundary: strength 2 is still low', async () => {
    const submitNotice = vi.fn(accepted)
    const { service } = await harness({
      withModel: true,
      submitNotice,
      output: () => ({ ...modelOutput(), polarity: 'bullish', strength: 2 })
    })

    await service.scoreItems({ itemIds: ['item-a'] })

    expect(submitNotice).not.toHaveBeenCalled()
  })

  it('stays silent for a routine announcement', async () => {
    const submitNotice = vi.fn(accepted)
    const { service } = await harness({
      withModel: true,
      submitNotice,
      output: () => ({ ...modelOutput(), polarity: 'neutral', strength: 2, symbols: [] }),
      items: [item({ title: 'OKX to Perform Scheduled Maintenance on the RFQ System' })]
    })

    await service.scoreItems({ itemIds: ['item-a'] })

    expect(submitNotice).not.toHaveBeenCalled()
  })

  it('stays silent for a neutral story whose strength is high — importance is not direction', async () => {
    const submitNotice = vi.fn(accepted)
    const { service } = await harness({
      withModel: true,
      submitNotice,
      output: () => ({ ...modelOutput(), polarity: 'neutral', strength: 3, symbols: [] }),
      items: [item({ title: 'Exchange publishes its quarterly reserve attestation' })]
    })

    await service.scoreItems({ itemIds: ['item-a'] })

    expect(submitNotice).toHaveBeenCalledTimes(1)
  })

  it('does not ring a second time when the same item is judged again', async () => {
    const submitNotice = vi.fn(accepted)
    const { service, store } = await harness({ withModel: true, submitNotice })
    await service.scoreItems({ itemIds: ['item-a'] })
    expect(submitNotice).toHaveBeenCalledTimes(1)

    // 第二次判定真的会发生（引擎从模型换成规则 ⇒ 旧判定「不是当前的」，同一条会被重新写一次）。
    // 这条新闻已经有判定，就不是「刚到的新新闻」——不许再响第二声。
    const rulesPass = await harness({ withModel: false, submitNotice, store, now: '2026-10-24T13:05:00.000Z' })
    await rulesPass.service.scoreItems({ itemIds: ['item-a'] })
    expect(store.getLatestSentiment('item-a', '2026-10-24T13:05:00.000Z')?.engine).toBe('rules')

    expect(submitNotice).toHaveBeenCalledTimes(1)
  })

  it('stays silent for 50 backfilled stories that arrive without an arrival set', async () => {
    const submitNotice = vi.fn(accepted)
    const many = Array.from({ length: 50 }, (_, index) =>
      item({ itemId: `bulk-${index}`, title: `SEC approves ETF options ${index}`, publishedAt: `2026-10-24T${String(10 + (index % 10)).padStart(2, '0')}:00:00.000Z` })
    )
    const { service } = await harness({ withModel: true, submitNotice, items: many })

    const result = await service.scoreItems({ limit: 50 })

    expect(result.processed).toBe(50)
    expect(submitNotice).not.toHaveBeenCalled()
  })

  it('stays silent for the source’s first collection, even with 200 new items', async () => {
    // PRD §5 的原句判据：新源（库内 0 条）首采 200 条 → 0 条。建档不是「来了 200 条新闻」。
    const submitNotice = vi.fn(accepted)
    const many = Array.from({ length: 200 }, (_, index) =>
      item({ itemId: `first-${index}`, title: `SEC approves ETF options ${index}`, publishedAt: `2026-10-24T${String(10 + (index % 10)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00.000Z` })
    )
    const { service } = await harness({ withModel: true, submitNotice, items: many })

    const result = await service.scoreItems({ itemIds: many.map((entry) => (entry as { itemId: string }).itemId), suppressArrivalNotices: true })

    // 一轮的评分上限是 20 条（重启后的那几轮会把剩下的补完）；**无论判了多少条，建档这一轮 0 通知**。
    expect(result.processed).toBe(20)
    expect(submitNotice).not.toHaveBeenCalled()
  })

  it('sends one notice per item — five non-low items in one round make five notices', async () => {
    // PRD §4：每条一弹、不合并。合并成「本轮 N 条」会让点开失去意义。
    const submitNotice = vi.fn(accepted)
    const five = Array.from({ length: 5 }, (_, index) =>
      item({ itemId: `round-${index}`, title: `SEC approves ETF options ${index}`, publishedAt: `2026-10-24T12:0${index}:00.000Z` })
    )
    const { service } = await harness({ withModel: true, submitNotice, items: five })

    await service.scoreItems({ itemIds: five.map((entry) => (entry as { itemId: string }).itemId) })

    expect(submitNotice).toHaveBeenCalledTimes(5)
    // 每条各一个去重键（按 itemId），所以平台那边不会把它们并成一条。
    const dedupeIds = submitNotice.mock.calls.map((call) => {
      const request = call[0] as NotificationSubmitRequest
      return request.dedupeVars.builder === 'template' ? request.dedupeVars.vars.itemId : undefined
    })
    expect(new Set(dedupeIds).size).toBe(5)
  })

  it('stays silent when the pass is a rebuild of history', async () => {
    const submitNotice = vi.fn(accepted)
    const { service } = await harness({ withModel: true, submitNotice })

    await service.scoreItems({ itemIds: ['item-a'], rebuild: true })

    expect(submitNotice).not.toHaveBeenCalled()
  })
})
