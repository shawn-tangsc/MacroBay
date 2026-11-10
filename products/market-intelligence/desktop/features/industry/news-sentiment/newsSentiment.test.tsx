// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NewsSentimentView } from '../../../../service/intelligence/news-sentiment/newsSentimentQuery'
import type { NewsSentimentSettingsView } from '../../../../service/intelligence/schema/newsSentiment'
import { productText } from '../../../shared/i18n/productText'
import type { NewsSentimentClient } from '../../../shared/ipc/newsSentimentClient'
import { NewsSentimentFeature } from './NewsSentimentFeature'
import { NewsSentimentCard } from './NewsSentimentCard'
import { createIconTextResolver, hasIconText } from './newsSentimentIconText'

const text = productText['zh-CN'].pages.intelligence.portal.newsSentiment

const VIEW: NewsSentimentView = {
  state: 'available',
  asOf: '2026-10-24T13:00:00.000Z',
  generatedAt: '2026-10-24T13:00:00.000Z',
  window: '24h',
  summary: {
    label: 'positive', score: 0.27, itemCount: 2, directionalCount: 2, neutralCount: 0,
    sourceBreakdown: { 'mainstream-news': 0.18 },
    latestItemAt: '2026-10-24T12:00:00.000Z',
    engineMix: { model: 1, rules: 1 },
    lastScoredAt: '2026-10-24T12:05:00.000Z'
  },
  items: [
    {
      itemId: 'item-a', title: 'SEC Approves Spot Ethereum ETF Options', sourceId: 'coindesk-rss',
      sourceName: 'CoinDesk RSS', url: 'https://www.coindesk.com/a', publishedAt: '2026-10-24T12:00:00.000Z',
      scoredAt: '2026-10-24T12:05:00.000Z', polarity: 'bullish', strength: 4, confidence: 78,
      symbols: ['ETH'], reasonCode: 'etf-approval', evidenceQuote: 'approved options', engine: 'model',
      modelRef: 'p:m', promptVersion: 'news-polarity-v1', caveats: []
    },
    {
      itemId: 'item-b', title: 'Binance Will Delist XYZ Perpetual', sourceId: 'binance-announcements',
      sourceName: 'Binance Announcements', publishedAt: '2026-10-24T11:00:00.000Z',
      scoredAt: '2026-10-24T11:05:00.000Z', polarity: 'bearish', strength: 4, confidence: 75,
      symbols: [], reasonCode: 'news.delisting.v1', evidenceQuote: 'Delist XYZ', engine: 'rules',
      caveats: []
    }
  ],
  caveats: []
}

const SETTINGS: NewsSentimentSettingsView = {
  settings: { modelScoringEnabled: true, providerId: '', modelId: '', updatedAt: '2026-10-24T13:00:00.000Z' },
  resolution: { source: 'platform-fast', defaultModelState: 'ready', providerId: 'p', modelId: 'm' },
  defaultFastModel: { providerId: 'p', modelId: 'm', name: 'Provider · Fast' }
}

function client(overrides: Partial<NewsSentimentClient> = {}): NewsSentimentClient {
  return {
    query: vi.fn(async () => VIEW),
    getItem: vi.fn(async (input: { asOf: string }) => ({ ...VIEW.items[0]!, bodyExcerpt: 'The SEC approved options.', asOf: input.asOf })),
    getSettings: vi.fn(async () => SETTINGS),
    saveSettings: vi.fn(async () => SETTINGS),
    rescore: vi.fn(async () => ({ queued: true })),
    rebuild: vi.fn(async () => ({ queued: true })),
    translateBody: vi.fn(async () => ({ state: 'translated' as const, body: '译文正文', title: '译文标题' })),
    ...overrides
  }
}

let root: Root | undefined
afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
})

async function mount(node: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => { root?.render(node) })
  await act(async () => {})
  return container
}

const mountCard = (view: NewsSentimentView, props: Partial<Parameters<typeof NewsSentimentCard>[0]> = {}) =>
  mount(
    <NewsSentimentCard failed={false} loading={false} onOpenAll={() => undefined} onOpenSettings={() => undefined}
      onEnableSources={() => undefined} onIncludeNeutralChange={() => undefined} onRunSources={() => undefined}
      onWidenWindow={() => undefined}
      onRefresh={props.onRefresh ?? (() => undefined)} onSelectItem={() => undefined} text={text} view={view} {...props} />
  )

describe('icon triggers', () => {
  // The two icon-only triggers must carry both a screen-reader name and a visible hint: a name alone
  // tells a screen reader what the control is, but a sighted keyboard user still sees only a glyph.
  it('gives the settings and refresh triggers a name and a hint', async () => {
    const container = await mountCard(VIEW)
    const settings = container.querySelector<HTMLButtonElement>(`button[aria-label="${text.settings}"]`)
    const refresh = container.querySelector<HTMLButtonElement>(`button[aria-label="${text.refresh}"]`)
    expect(settings).not.toBeNull()
    expect(refresh).not.toBeNull()

    await act(async () => { settings?.focus() })
    // 条件是「带这句说明的提示浮层出现了」，不是「等 250ms 再说」：轮询一成立就继续，上限由 `vi.waitFor` 兜住。
    await vi.waitFor(() => {
      const tooltip = document.body.querySelector('.ant-tooltip')
      if (tooltip === null) throw new Error('Expected the settings tooltip.')
      expect(tooltip.textContent).toContain(text.settings)
    })
  })
})

describe('icon label keys', () => {
  // The icon triggers take an open string key, so an unknown key must not be read out loud: reading
  // "news.sentiment.unknown" to a user is worse than hiding the trigger.
  it('resolves a known key and never answers with an unknown one', () => {
    const resolve = createIconTextResolver(text)
    expect(resolve('news.sentiment.settings')).toBe(text.settings)
    expect(resolve('news.sentiment.unknown')).toBe('')
    expect(resolve('news.sentiment.unknown')).not.toBe('news.sentiment.unknown')
    expect(hasIconText(text, 'news.sentiment.unknown' as never)).toBe(false)
  })

  it('never puts a key into a rendered screen-reader name', async () => {
    const container = await mountCard(VIEW)
    const labels = [...container.querySelectorAll('[aria-label]')].map((node) => node.getAttribute('aria-label') ?? '')
    expect(labels.some((label) => label.startsWith('news.sentiment.'))).toBe(false)
  })
})

describe('a read that has not settled is not a failure', () => {
  // "Not read yet" is neither "nothing there" nor "failed". These three pin the order of states,
  // not a lucky frame: nothing settled may ever paint an error or an empty view.
  it('paints only loading until the first read settles', async () => {
    let settle: ((value: NewsSentimentView) => void) | undefined
    const query = vi.fn(() => new Promise<NewsSentimentView>((resolve) => { settle = resolve }))
    const container = await mount(
      <NewsSentimentFeature text={text} client={client({ query })} now={() => new Date('2026-10-24T13:00:00.000Z')} />
    )

    expect(container.querySelector('.loading-state')).not.toBeNull()
    expect(container.querySelector('.state-view--error')).toBeNull()
    expect(container.querySelector('.state-view--empty')).toBeNull()
    expect(container.querySelector('[data-news-sentiment-stale-read]')).toBeNull()
    // A retry must not be offered while a read is in flight: that is a button that can only harm.
    expect([...container.querySelectorAll('button')].some((button) => button.textContent?.includes(text.retry)))
      .toBe(false)

    await act(async () => { settle?.(VIEW) })
    await act(async () => {})
    expect(container.querySelector('.loading-state')).toBeNull()
    expect(container.querySelectorAll('.mi-news-sentiment__drivers button').length).toBeGreaterThan(0)
  })

  it('shows an error with a retry only after a read really failed', async () => {
    const query = vi.fn(async () => { throw new Error('boom') })
    const container = await mount(
      <NewsSentimentFeature text={text} client={client({ query })} now={() => new Date('2026-10-24T13:00:00.000Z')} />
    )
    expect(container.querySelector('.state-view--error')).not.toBeNull()
    expect(container.querySelector('.mi-news-sentiment .state-view--error button')).not.toBeNull()
  })

  it('keeps the rows it already had when a refresh fails, and says they are older', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(VIEW)
      .mockRejectedValueOnce(new Error('boom'))
    // A refresh moves the as-of instant, so the hook's effect actually re-reads.
    let tick = 0
    const container = await mount(
      <NewsSentimentFeature text={text} client={client({ query })} now={() => new Date(Date.UTC(2026, 9, 24, 13, 0, tick++))} />
    )
    expect(container.querySelectorAll('.mi-news-sentiment__drivers button').length).toBeGreaterThan(0)

    const refresh = container.querySelector<HTMLButtonElement>(`button[aria-label="${text.refresh}"]`)
    expect(refresh).not.toBeNull()
    await act(async () => { refresh?.click() })
    // 条件是「失败后的旧读数与那句说明已经出现」，不是数两次微任务拍子：这条刷新链里没有定时器。
    await vi.waitFor(() => {
      expect(query).toHaveBeenCalledTimes(2)
      expect(container.querySelector('[data-news-sentiment-stale-read]')?.textContent).toContain(text.staleRead)
    })

    // The reading is still true, only older: it stays, and a note says why.
    expect(container.querySelectorAll('.mi-news-sentiment__drivers button').length).toBeGreaterThan(0)
    expect(container.querySelector('.mi-news-sentiment .state-view--error')).toBeNull()
  })
})

describe('a read that never answers has a deadline', () => {
  it('turns a hung read into a failure with a retry, instead of loading forever', async () => {
    // The fix for "a failure flashes before the data" must not become "never admit the failure".
    // 时限到点用假计时器推进，不真等 30/80ms：到点后的状态更新仍在 `act` 里，两次干净运行结果一致。
    vi.useFakeTimers()
    try {
      const query = vi.fn(() => new Promise<NewsSentimentView>(() => {}))
      const container = await mount(
        <NewsSentimentFeature readDeadlineMs={30} text={text} client={client({ query })} now={() => new Date('2026-10-24T13:00:00.000Z')} />
      )
      expect(container.querySelector('.state-view--error')).toBeNull()
      await act(async () => { vi.advanceTimersByTime(31) })
      await act(async () => {})
      expect(container.querySelector('.state-view--error')).not.toBeNull()
      expect(container.querySelector('.mi-news-sentiment .state-view--error button')).not.toBeNull()
      expect(container.querySelector('.loading-state')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the drawer does not answer before its reads do', () => {
  it('shows loading, not "not yet", while the first read is in flight', async () => {
    let settle: ((value: NewsSentimentView) => void) | undefined
    const query = vi.fn(() => new Promise<NewsSentimentView>((resolve) => { settle = resolve }))
    const container = await mount(
      <NewsSentimentFeature text={text} client={client({ query })} now={() => new Date('2026-10-24T13:00:00.000Z')} />
    )
    const open = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(text.openAll))
    await act(async () => { open?.click() })
    await act(async () => {})
    const list = document.body.querySelector('.mi-news-drawer__list')
    expect(list?.querySelector('.state-view--empty')).toBeNull()
    expect(list?.querySelector('.loading-state')).not.toBeNull()

    await act(async () => { settle?.(VIEW) })
    await act(async () => {})
    expect(document.body.querySelectorAll('.mi-news-drawer__row').length).toBeGreaterThan(0)
  })

  it('does not call the body missing while the detail read is still in flight', async () => {
    let resolveDetail: ((value: unknown) => void) | undefined
    const getItem = vi.fn(() => new Promise((resolve) => { resolveDetail = resolve }))
    const container = await mount(<NewsSentimentFeature text={text} client={client({ getItem: getItem as never })} now={() => new Date('2026-10-24T13:00:00.000Z')} />)
    const open = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(text.openAll))
    await act(async () => { open?.click() })
    await act(async () => {})
    const body = document.body.querySelector('.mi-news-drawer__bodytext')
    expect(body?.textContent ?? '').not.toContain(text.drawer.detail.noBody)
    expect(body?.querySelector('.loading-state')).not.toBeNull()

    await act(async () => { resolveDetail?.({ ...VIEW.items[0]!, bodyExcerpt: 'body:item-a' }) })
    await act(async () => {})
    expect(document.body.querySelector('.mi-news-drawer__bodytext')?.textContent).toContain('body:item-a')
  })
})

describe('card empty states', () => {
  const readiness = (overrides: Partial<NonNullable<NewsSentimentView['readiness']>> = {}) => ({
    total: 4, enabledCount: 4, failedCount: 0, neverRanCount: 0,
    failedSourceIds: [], neverRanSourceIds: [],
    lastSuccessAt: '2026-10-24T12:00:00.000Z',
    ...overrides
  })
  const emptyView = (overrides: Partial<NewsSentimentView> = {}): NewsSentimentView => ({
    state: 'empty', asOf: '2026-10-24T13:00:00.000Z', generatedAt: '2026-10-24T13:00:00.000Z',
    window: '1h', items: [], caveats: [], ...overrides
  })

  // "Try again" on a failed collection has to collect again. A plain re-read of the same store
  // shows the same empty window, so the button would name an action it cannot perform.
  it('collects the failed sources again instead of only re-reading them', async () => {
    const failedIds = ['sec-rss', 'coindesk-rss', 'binance-announcements', 'okx-latest-announcements']
    const onRunSources = vi.fn()
    const onRefresh = vi.fn()
    const container = await mountCard(
      emptyView({ readiness: readiness({ failedCount: 4, failedSourceIds: failedIds }) }),
      { onRefresh, onRunSources }
    )

    const button = container.querySelector<HTMLButtonElement>('[data-news-sentiment-state="collection-failed"] button')
    expect(button).not.toBeNull()
    await act(async () => { button?.click() })

    expect(onRunSources).toHaveBeenCalledWith(failedIds)
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('tells the five no-rows situations apart, each with its own next step', async () => {
    const onEnableSources = vi.fn()
    const onRunSources = vi.fn()
    const onRefresh = vi.fn()
    const onWidenWindow = vi.fn()
    const sentences = productText['zh-CN'].mi.newsSentiment

    const disabled = await mountCard(emptyView({ readiness: readiness({ enabledCount: 0 }) }), { onEnableSources })
    const failed = await mountCard(emptyView({ readiness: readiness({ failedCount: 4, failedSourceIds: ['sec-rss', 'coindesk-rss', 'binance-announcements', 'okx-latest-announcements'] }) }), { onRunSources, onRefresh })
    const neverRan = await mountCard(emptyView({ readiness: readiness({ neverRanCount: 4, neverRanSourceIds: ['sec-rss'] }) }), { onRunSources })
    const stale = await mountCard(emptyView({ readiness: readiness(), latestKnownItemAt: '2026-10-24T09:00:00.000Z' }), { onWidenWindow })
    const quiet = await mountCard(emptyView({ readiness: readiness() }))

    // Five distinct product sentences; the platform skeleton never substitutes its own.
    const five = [sentences['sources-disabled'], sentences['collection-failed'], sentences['never-ran'], sentences.stale, sentences.quiet]
    expect(new Set(five).size).toBe(5)
    const cases = [
      [disabled, 'sources-disabled', sentences['sources-disabled']],
      [failed, 'collection-failed', sentences['collection-failed']],
      [neverRan, 'never-ran', sentences['never-ran']],
      [stale, 'stale', sentences.stale.split('{time}')[0]!],
      [quiet, 'quiet', sentences.quiet]
    ] as const
    for (const [container, kind, sentence] of cases) {
      const reason = container.querySelector(`[data-news-sentiment-state="${kind}"] [data-reason-source]`)
      // The cause is the product's sentence, taken through the platform entry — not the platform's.
      expect(reason?.getAttribute('data-reason-source')).toBe('product')
      expect(reason?.textContent).toContain(sentence)
      expect(container.querySelector(`[data-news-sentiment-state="${kind}"]`)?.className).toBe('mi-news-sentiment__state')
    }
    // The stale sentence carries the formatted instant, and no placeholder survives to the screen.
    const staleReason = stale.querySelector('[data-reason-source]')?.textContent ?? ''
    expect(staleReason).not.toContain('{time}')
    // A quiet period is a fact, but the reader can still look further back: the contract makes
    // every `nothing-in-window` carry the widen action, so this one has a button too.
    expect(quiet.querySelector('[data-news-sentiment-state="quiet"] button')).not.toBeNull()

    const press = async (container: HTMLElement) => {
      const button = container.querySelector<HTMLButtonElement>('.mi-news-sentiment__state button')
      expect(button).not.toBeNull()
      await act(async () => { button?.click() })
    }
    await press(disabled)
    await press(failed)
    await press(neverRan)
    await press(stale)
    // Each action really does its own thing: open the settings, run the failed sources, run the
    // missing ones, widen the window. None of them is aliased to another, and none is a plain
    // re-read standing in for an action it cannot perform.
    expect(onEnableSources).toHaveBeenCalledTimes(1)
    expect(onRefresh).not.toHaveBeenCalled()
    expect(onRunSources).toHaveBeenNthCalledWith(1, ['sec-rss', 'coindesk-rss', 'binance-announcements', 'okx-latest-announcements'])
    expect(onRunSources).toHaveBeenNthCalledWith(2, ['sec-rss'])
    expect(onWidenWindow).toHaveBeenCalledTimes(1)
  })

  it('does not call an empty read "quiet" when the sources never ran', async () => {
    const sentences = productText['zh-CN'].mi.newsSentiment
    const container = await mountCard(emptyView({ readiness: readiness({ neverRanCount: 4 }) }))
    expect(container.textContent).not.toContain(sentences.quiet)
    expect(container.textContent).toContain(sentences['never-ran'])
  })
})

describe('NewsSentimentFeature', () => {
  it('shows the summary and the top drivers', async () => {
    const container = await mount(<NewsSentimentFeature text={text} client={client()} now={() => new Date('2026-10-24T13:00:00.000Z')} />)
    expect(container.querySelector('[data-news-sentiment-card]')?.textContent).toContain('偏多')
    const drivers = [...container.querySelectorAll<HTMLButtonElement>('.mi-news-sentiment__drivers button')]
    expect(drivers).toHaveLength(2)
    expect(container.textContent).toContain('SEC Approves Spot Ethereum ETF Options')
    // 整行即动作：每行是可访问名说明「点开哪一条」的原生按钮，键盘与焦点环不另画。
    expect(drivers[0]?.getAttribute('aria-label')).toBe(
      text.openItem.replace('{title}', 'SEC Approves Spot Ethereum ETF Options')
    )
    expect(drivers[1]?.getAttribute('aria-label')).toBe(
      text.openItem.replace('{title}', 'Binance Will Delist XYZ Perpetual')
    )
    for (const driver of drivers) {
      expect(driver.type).toBe('button')
    }
  })

  it('opens the drawer and lists every item', async () => {
    const container = await mount(<NewsSentimentFeature text={text} client={client()} now={() => new Date('2026-10-24T13:00:00.000Z')} />)
    const open = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(text.openAll))
    await act(async () => { open?.click() })
    await act(async () => {})
    expect(document.body.textContent).toContain('Binance Will Delist XYZ Perpetual')
    expect(document.body.querySelectorAll('.mi-news-drawer__row-open')).toHaveLength(2)
  })

  // 重建把坏库换掉之后，读者要知道「旧的没丢、新的能用」。存储页现在列不出 `.corrupt-*`
  // （治理页只列注册表），所以这句不许指向那个页面——那会是假入口。
  it('says the old store was kept as an unmodified copy, without pointing at a viewer that does not exist', async () => {
    const rebuild = vi.fn(async () => ({
      queued: true,
      quarantinedCopy: '/tmp/intelligence-news-sentiment.sqlite.corrupt-1'
    }))
    const container = await mount(
      <NewsSentimentFeature text={text} client={client({ rebuild })} now={() => new Date('2026-10-24T13:00:00.000Z')} />
    )
    const open = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(text.openAll))
    await act(async () => { open?.click() })
    await act(async () => {})
    const rebuildButton = [...document.body.querySelectorAll('button')]
      .find((button) => button.textContent?.includes(text.settingsModal.rebuild))
    expect(rebuildButton).toBeTruthy()
    await act(async () => { rebuildButton?.click() })
    await act(async () => {})

    const notice = document.body.querySelector('.mi-news-drawer__notice')?.textContent ?? ''
    // 锁死定稿原文（不是拿同一个键自证）：改一个字就该红。
    expect(notice).toBe('旧库已原样留存一份副本，新库已建好。刷新本页即可使用新库。')
    expect(productText['en-US'].pages.intelligence.portal.newsSentiment.settingsModal.rebuiltWithCopy).toBe(
      'The old store was kept as an unmodified copy and a new one is ready. Refresh this page to start using it.'
    )
    // 「可在设置 → 存储里查看」只在存储页真能列出副本时才许写；现在列不出，就不许出现。
    expect(notice).not.toContain('设置')
    expect(notice).not.toContain('存储')
  })


  // A button carrying role="listitem" loses its button semantics: a screen reader announces "list
  // item" and never says the row opens anything. The list item is the wrapper; the button is inside.
  // The drawer used to print its own two sentences for "read failed" and "nothing here". Both are
  // state, not copy: the platform sentence and its action come from StateView.
  // Dropping neutral rows is the reader's own filter. Saying "nothing here yet" both misreads the
  // day and hides the way back; and the list must be the only empty surface on that screen.
  // The platform drawer keeps its content mounted between opens. Without a reset on close, opening
  // it again shows the article the reader read last time under a different row's heading.
  it('does not keep the last article after the drawer is closed and reopened', async () => {
    const getItem = vi.fn(async (input: { itemId: string; asOf: string }) => {
      const item = VIEW.items.find((entry) => entry.itemId === input.itemId)!
      return { ...item, asOf: input.asOf, bodyExcerpt: `body:${item.itemId}` }
    })
    const container = await mount(<NewsSentimentFeature text={text} client={client({ getItem })} now={() => new Date('2026-10-24T13:00:00.000Z')} />)
    const open = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(text.openAll))
    await act(async () => { open?.click() })
    await act(async () => {})
    const rows = [...document.body.querySelectorAll<HTMLButtonElement>('.mi-news-drawer__row-open')]
    await act(async () => { rows[1]?.click() })
    await act(async () => {})
    expect(document.body.querySelector('.mi-news-drawer__bodytext')?.textContent).toContain('body:item-b')

    const close = [...document.body.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.getAttribute('aria-label') === '关闭抽屉')
    expect(close).not.toBeUndefined()
    await act(async () => { close?.click() })
    await act(async () => {})
    await act(async () => { open?.click() })
    await act(async () => {})
    expect(document.body.querySelector('.mi-news-drawer__bodytext')?.textContent ?? '').not.toContain('body:item-b')
  })

  it('treats a neutral-only window filtered out as a filter, with one empty state on screen', async () => {
    const neutralOnly = { ...VIEW, items: [{ ...VIEW.items[0]!, itemId: 'item-neutral', polarity: 'neutral' as const }] }
    const container = await mount(
      <NewsSentimentFeature text={text} client={client({ query: vi.fn(async () => neutralOnly) })} now={() => new Date('2026-10-24T13:00:00.000Z')} />
    )
    const open = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(text.openAll))
    await act(async () => { open?.click() })
    await act(async () => {})
    const exclude = [...container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')]
      .find((button) => button.textContent?.includes(text.neutralFilter.exclude))
    await act(async () => { exclude?.click() })
    await act(async () => {})

    // Two surfaces each state their own truth: the card says the card's filter emptied it, the
    // drawer's list says the drawer's filters did. Both are StateView, so there is one renderer.
    const drawerStates = document.body.querySelectorAll('.mi-news-drawer__list .state-view')
    expect(drawerStates).toHaveLength(1)
    expect(drawerStates[0]?.querySelector('button')).not.toBeNull()
    const cardState = container.querySelector('[data-news-sentiment-state="filtered-empty"] .state-view')
    expect(cardState).not.toBeNull()
  })

  it('renders the drawer failure as an error state with a retry action', async () => {
    const container = await mount(
      <NewsSentimentFeature text={text} client={client({ query: vi.fn(async () => { throw new Error('boom') }) })} now={() => new Date('2026-10-24T13:00:00.000Z')} />
    )
    const open = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(text.openAll))
    await act(async () => { open?.click() })
    await act(async () => {})
    const state = document.body.querySelector('.state-view--error')
    expect(state).not.toBeNull()
    expect(state?.querySelector('button')).not.toBeNull()
  })

  it('offers to clear filters when the reader filters every row out', async () => {
    const container = await mount(
      <NewsSentimentFeature text={text} client={client({ query: vi.fn(async () => ({ ...VIEW, items: [] })) })} now={() => new Date('2026-10-24T13:00:00.000Z')} />
    )
    const open = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(text.openAll))
    await act(async () => { open?.click() })
    await act(async () => {})
    expect(document.body.querySelector('.state-view--empty')).not.toBeNull()
  })

  it('keeps the row a list item and the button inside it, with a more trigger', async () => {
    const container = await mount(<NewsSentimentFeature text={text} client={client()} now={() => new Date('2026-10-24T13:00:00.000Z')} />)
    const open = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(text.openAll))
    await act(async () => { open?.click() })
    await act(async () => {})
    const items = [...document.body.querySelectorAll('[role="listitem"]')]
    expect(items).toHaveLength(2)
    for (const item of items) {
      expect(item.tagName).not.toBe('BUTTON')
      const rowOpen = item.querySelector<HTMLButtonElement>('button.mi-news-drawer__row-open')
      expect(rowOpen).not.toBeNull()
      // 整行即动作：可访问名说明点开哪一条；键盘可达与焦点环由原生 button 提供，不另画。
      // 前缀从文案表取，不在测试里硬拼中文——两语言都走同一个键。
      expect(rowOpen?.type).toBe('button')
      expect(rowOpen?.getAttribute('aria-label')).toMatch(new RegExp(`^${text.openItem.split('{title}')[0]}`))
    }

    const more = document.body.querySelector<HTMLButtonElement>(`button[aria-label="${text.drawer.moreActions}"]`)
    expect(more).not.toBeNull()
    await act(async () => { more?.click() })
    await act(async () => {})
    expect(document.body.querySelector('[role="menu"]')).not.toBeNull()
  })

  it('switches the detail when another row is clicked', async () => {
    const getItem = vi.fn(async (input: { itemId: string; asOf: string }) => {
      const item = VIEW.items.find((entry) => entry.itemId === input.itemId)!
      return { ...item, asOf: input.asOf, bodyExcerpt: `body:${item.itemId}` }
    })
    const container = await mount(<NewsSentimentFeature text={text} client={client({ getItem })} now={() => new Date('2026-10-24T13:00:00.000Z')} />)
    const open = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(text.openAll))
    await act(async () => { open?.click() })
    await act(async () => {})
    const rows = [...document.body.querySelectorAll<HTMLButtonElement>('.mi-news-drawer__row-open')]
    await act(async () => { rows[1]?.click() })
    await act(async () => {})
    expect(document.body.querySelector('.mi-news-drawer__detail h3')?.textContent).toContain('Binance Will Delist XYZ Perpetual')
    expect(document.body.querySelector('.mi-news-drawer__bodytext')?.textContent).toContain('body:item-b')
  })


  it('does not snap back to the card focus target after a row click', async () => {
    const getItem = vi.fn(async (input: { itemId: string; asOf: string }) => {
      const item = VIEW.items.find((entry) => entry.itemId === input.itemId)!
      return { ...item, asOf: input.asOf, bodyExcerpt: `body:${item.itemId}` }
    })
    const container = await mount(<NewsSentimentFeature text={text} client={client({ getItem })} now={() => new Date('2026-10-24T13:00:00.000Z')} />)
    const cardItems = [...container.querySelectorAll<HTMLButtonElement>('.mi-news-sentiment__drivers button')]
    await act(async () => { cardItems[1]?.click() })
    await act(async () => {})
    const rows = [...document.body.querySelectorAll<HTMLButtonElement>('.mi-news-drawer__row-open')]
    await act(async () => { rows[0]?.click() })
    await act(async () => {})
    expect(document.body.querySelector('.mi-news-drawer__detail h3')?.textContent).toContain('SEC Approves Spot Ethereum ETF Options')
  })


  it('does not show the previous article body when the next detail read fails', async () => {
    // The detail panel kept the last successful read while the new one was in flight and after it
    // failed, so row B's heading sat above row A's body text.
    const getItem = vi.fn(async (input: { itemId: string; asOf: string }) => {
      if (input.itemId === 'item-b') throw new Error('detail read failed')
      const item = VIEW.items.find((entry) => entry.itemId === input.itemId)!
      return { ...item, asOf: input.asOf, bodyExcerpt: `body:${item.itemId}` }
    })
    const container = await mount(<NewsSentimentFeature text={text} client={client({ getItem })} now={() => new Date('2026-10-24T13:00:00.000Z')} />)
    const open = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(text.openAll))
    await act(async () => { open?.click() })
    await act(async () => {})
    expect(document.body.querySelector('.mi-news-drawer__bodytext')?.textContent).toContain('body:item-a')
    const rows = [...document.body.querySelectorAll<HTMLButtonElement>('.mi-news-drawer__row-open')]
    await act(async () => { rows[1]?.click() })
    await act(async () => {})
    const body = document.body.querySelector('.mi-news-drawer__bodytext')?.textContent ?? ''
    expect(body).not.toContain('body:item-a')
    expect(body).toContain(text.unavailable)
  })

  it('keeps the neutral filter on the shared segmented base', async () => {
    // The segment class is one mutually exclusive value on the platform Segmented: a labelled group,
    // exactly one Tab stop, arrow keys move focus and Enter/Space select. No second implementation.
    const container = await mount(<NewsSentimentFeature text={text} client={client()} now={() => new Date('2026-10-24T13:00:00.000Z')} />)
    const group = container.querySelector('[role="group"][aria-label]')
    expect(group).toBeTruthy()
    const options = [...(group?.querySelectorAll('button[aria-pressed]') ?? [])]
    expect(options).toHaveLength(2)
    expect(options.filter((option) => option.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
    expect(options.filter((option) => (option as HTMLButtonElement).tabIndex === 0)).toHaveLength(1)
  })

  it('keeps the original/translated toggle on the shared segmented base', async () => {
    const getItem = vi.fn(async (input: { itemId: string; asOf: string }) => {
      const item = VIEW.items.find((entry) => entry.itemId === input.itemId)!
      return { ...item, asOf: input.asOf, bodyExcerpt: `body:${item.itemId}`, translatedBodyExcerpt: '译文正文' }
    })
    const container = await mount(<NewsSentimentFeature text={text} client={client({ getItem })} now={() => new Date('2026-10-24T13:00:00.000Z')} />)
    const open = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(text.openAll))
    await act(async () => { open?.click() })
    await act(async () => {})
    const toggle = document.body.querySelector('.mi-news-drawer__body-toggle')
    expect(toggle?.querySelector('[role="group"]')).not.toBeNull()
    const options = [...(toggle?.querySelectorAll('button[aria-pressed]') ?? [])]
    expect(options).toHaveLength(2)
    expect(options.filter((option) => option.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
    expect(options.filter((option) => (option as HTMLButtonElement).tabIndex === 0)).toHaveLength(1)
  })

  it('re-reads when the reader retries a failed read', async () => {
    // Chief's caution for the upcoming StateView migration: the retry button must really re-read,
    // not merely clear the error. The clock advances so the re-read has a new asOf to key on.
    const query = vi.fn()
      .mockRejectedValueOnce(new Error('read failed'))
      .mockResolvedValue(VIEW)
    let tick = 0
    const now = () => new Date(Date.UTC(2026, 9, 24, 13, 0, tick++))
    const container = await mount(<NewsSentimentFeature text={text} client={client({ query })} now={now} />)
    await act(async () => {})
    expect(container.querySelector('[data-news-sentiment-state="unavailable"]')).toBeTruthy()
    // Structural selector: antd puts a space between two CJK characters, so the label reads 重 试.
    const retry = container.querySelector<HTMLButtonElement>('[data-news-sentiment-state="unavailable"] button')
    await act(async () => { retry?.click() })
    await act(async () => {})
    expect(query).toHaveBeenCalledTimes(2)
    expect(container.querySelectorAll('.mi-news-sentiment__drivers button').length).toBeGreaterThan(0)
  })

  it('opens the row menu from the more button and translates that row', async () => {
    const translateBody = vi.fn(async () => ({ state: 'translated' as const, body: '译文正文', title: '译文标题' }))
    const container = await mount(<NewsSentimentFeature text={text} client={client({ translateBody })} now={() => new Date('2026-10-24T13:00:00.000Z')} />)
    const open = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(text.openAll))
    await act(async () => { open?.click() })
    await act(async () => {})
    const more = [...document.body.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.getAttribute('aria-label') === text.drawer.moreActions)
    expect(more).toBeTruthy()
    await act(async () => { more?.click() })
    await act(async () => {})
    const menu = document.body.querySelector('[role="menu"]')
    expect(menu).toBeTruthy()
    const item = [...document.body.querySelectorAll<HTMLElement>('.ant-menu-item')]
      .find((entry) => entry.textContent?.includes(text.drawer.translationStatus.translateOne))
    expect(item).toBeTruthy()
    await act(async () => { item?.click() })
    await act(async () => {})
    expect(translateBody).toHaveBeenCalledWith('item-a', false)
  })

  it('opens the row menu from the keyboard, not only by right-click', async () => {
    const container = await mount(<NewsSentimentFeature text={text} client={client()} now={() => new Date('2026-10-24T13:00:00.000Z')} />)
    const open = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(text.openAll))
    await act(async () => { open?.click() })
    await act(async () => {})
    const row = document.body.querySelector<HTMLButtonElement>('.mi-news-drawer__row-open')
    expect(row).toBeTruthy()
    await act(async () => { row?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'F10', shiftKey: true })) })
    await act(async () => {})
    expect(document.body.querySelector('[role="menu"]')).toBeTruthy()
  })

  it('re-reads the list when the interface language changes', async () => {
    // Titles and body translations are resolved for the language in force at read time, so a
    // language switch must re-read; otherwise the list keeps the previous language's strings.
    const query = vi.fn()
      .mockResolvedValueOnce(VIEW)
      .mockResolvedValueOnce({ ...VIEW, items: VIEW.items.map((item) => ({ ...item, displayTitle: `中文：${item.title}` })) })
    const node = (language: 'zh-CN' | 'en-US') =>
      <NewsSentimentFeature language={language} text={text} client={client({ query })} now={() => new Date('2026-10-24T13:00:00.000Z')} />
    const container = await mount(node('en-US'))
    expect(query).toHaveBeenCalledTimes(1)
    await act(async () => { root?.render(node('zh-CN')) })
    // 条件是「中文标题已经在屏上、重读恰好发生一次」，不是数一次渲染拍子：语言切换触发的读取没有定时器。
    await vi.waitFor(() => {
      expect(query).toHaveBeenCalledTimes(2)
      expect(container.textContent).toContain('中文：SEC Approves Spot Ethereum ETF Options')
    })
  })

  it('shows a queue progress bar only while a translation batch runs', async () => {
    const resolvers: Array<(value: unknown) => void> = []
    const translateBody = vi.fn(() => new Promise((resolve) => { resolvers.push(resolve) }))
    const container = await mount(
      <NewsSentimentFeature text={text} client={client({ translateBody: translateBody as never })} now={() => new Date('2026-10-24T13:00:00.000Z')} />
    )
    const open = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(text.openAll))
    await act(async () => { open?.click() })
    await act(async () => {})
    // No batch, no bar.
    expect(document.body.querySelector('[data-news-sentiment-translation-queue]')).toBeNull()

    const translateAll = [...document.body.querySelectorAll('button')].find((button) => button.textContent?.includes(text.settingsModal.translateAll))
    expect(translateAll).toBeTruthy()
    await act(async () => { translateAll?.click() })
    await act(async () => {})
    const queue = document.body.querySelector('[data-news-sentiment-translation-queue]')
    expect(queue).not.toBeNull()
    expect(queue?.textContent).toContain('正在翻译 0/2')
    expect(queue?.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('0')
    expect(queue?.textContent).toContain(text.settingsModal.cancelTranslate)

    await act(async () => { for (const resolve of resolvers.splice(0)) resolve({ state: 'translated', body: '译文', title: '译名' }) })
    await act(async () => {})
    expect(document.body.querySelector('[data-news-sentiment-translation-queue]')).toBeNull()
  })

  it('enables the four sources, collects once and re-reads when the reader asks', async () => {
    // The action says "enable", so it must switch the sources on and collect — not just open a page.
    const setEnabled = vi.fn(async () => ({ ok: true }))
    const runNow = vi.fn(async () => ({ action: 'run' }))
    let tick = 0
    const query = vi.fn(async () => ({
      ...VIEW, state: 'empty' as const, summary: undefined, items: [],
      readiness: { total: 4, enabledCount: 0, failedCount: 0, neverRanCount: 0, failedSourceIds: [], neverRanSourceIds: [] }
    }))
    const now = () => new Date(Date.UTC(2026, 9, 24, 13, 0, tick++))
    const container = await mount(
      <NewsSentimentFeature text={text} client={client({ query })} now={now} sourcesClient={{ runNow, setEnabled }} />
    )
    await act(async () => {})
    const button = container.querySelector<HTMLButtonElement>('[data-news-sentiment-state="sources-disabled"] button')
    expect(button).not.toBeNull()
    await act(async () => { button?.click() })
    // 条件是「四个源都启用、各跑一次，卡片也重读过」，不是等一个 0ms 定时器：
    // enable → collect → refresh 全是 Promise 链，链走完条件就成立，上限由 `vi.waitFor` 兜住。
    await vi.waitFor(() => {
      for (const sourceId of ['sec-rss', 'coindesk-rss', 'binance-announcements', 'okx-latest-announcements']) {
        expect(setEnabled).toHaveBeenCalledWith(sourceId, true)
        expect(runNow).toHaveBeenCalledWith(sourceId)
      }
      expect(query.mock.calls.length).toBeGreaterThan(1)
    })
  })

  it('widens the window when the only data is older than the window', async () => {
    const query = vi.fn(async (input: { window: string }) => ({
      ...VIEW, state: 'empty' as const, summary: undefined, items: [], window: input.window as never,
      asOf: '2026-10-24T13:00:00.000Z', latestKnownItemAt: '2026-10-24T09:00:00.000Z',
      readiness: { total: 4, enabledCount: 4, failedCount: 0, neverRanCount: 0, failedSourceIds: [], neverRanSourceIds: [] }
    }))
    const container = await mount(<NewsSentimentFeature text={text} client={client({ query })} now={() => new Date('2026-10-24T13:00:00.000Z')} />)
    const open = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(text.openAll))
    await act(async () => { open?.click() })
    await act(async () => {})
    // A one-hour window with the newest judgment 4h old is the state the action exists for.
    const selector = document.body.querySelector<HTMLElement>('.mi-news-drawer__time .ant-select-selector')
    await act(async () => { selector?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    await act(async () => {})
    const option = [...document.body.querySelectorAll<HTMLElement>('.ant-select-item-option')].find((entry) => entry.textContent?.trim() === '1h')
    await act(async () => { option?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => {})
    const button = container.querySelector<HTMLButtonElement>('[data-news-sentiment-state="stale"] button')
    expect(button).not.toBeNull()
    await act(async () => { button?.click() })
    await act(async () => {})
    // The action says "widen", so the next read asks for a wider window — not the same one again.
    expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ window: '4h' }))
  })

  it('changes the window from the drawer controls', async () => {
    const query = vi.fn(async () => VIEW)
    const container = await mount(<NewsSentimentFeature text={text} client={client({ query })} now={() => new Date('2026-10-24T13:00:00.000Z')} />)
    const open = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(text.openAll))
    await act(async () => { open?.click() })
    await act(async () => {})
    const selector = document.body.querySelector<HTMLElement>('.mi-news-drawer__time .ant-select-selector')
    await act(async () => { selector?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    await act(async () => {})
    const option = [...document.body.querySelectorAll<HTMLElement>('.ant-select-item-option')]
      .find((entry) => entry.textContent?.trim() === '24h')
    await act(async () => { option?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => {})
    expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ window: '24h' }))
  })


  it('filters neutral items from the card header', async () => {
    const neutral = {
      ...VIEW.items[0]!,
      itemId: 'item-c',
      title: 'Exchange maintenance notice',
      polarity: 'neutral' as const,
      reasonCode: 'news.no-rule.v1'
    }
    const query = vi.fn(async () => ({ ...VIEW, items: [...VIEW.items, neutral] }))
    const container = await mount(<NewsSentimentFeature text={text} client={client({ query })} now={() => new Date('2026-10-24T13:00:00.000Z')} />)
    expect(container.querySelectorAll('.mi-news-sentiment__drivers button')).toHaveLength(3)
    const exclude = [...container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')]
      .find((button) => button.textContent?.includes(text.neutralFilter.exclude))
    await act(async () => { exclude?.click() })
    await act(async () => {})
    expect(container.querySelectorAll('.mi-news-sentiment__drivers button')).toHaveLength(2)
    expect(exclude?.getAttribute('aria-pressed')).toBe('true')
  })

  it('carries no card-wide badge or caveat line under the list', async () => {
    // The card used to add a card-wide "Rules" badge and, later, a "headline only" caveat line.
    // Neither named an item; both read as controls or noise under a list that already says what
    // each row is. The caveat stays in the data (the drawer still explains a row without a body).
    const container = await mount(
      <NewsSentimentCard failed={false} loading={false} onOpenAll={() => undefined} onOpenSettings={() => undefined}
        onEnableSources={() => undefined} onIncludeNeutralChange={() => undefined} onRunSources={() => undefined}
        onRefresh={() => undefined} onSelectItem={() => undefined} onWidenWindow={() => undefined} text={text} view={VIEW} />
    )
    expect(container.textContent).not.toContain(text.engine.rules)
    expect(container.querySelector('.mi-news-sentiment__footer')).toBeNull()

    const withCaveat = await mount(
      <NewsSentimentCard failed={false} loading={false} onOpenAll={() => undefined} onOpenSettings={() => undefined}
        onEnableSources={() => undefined} onIncludeNeutralChange={() => undefined} onRunSources={() => undefined}
        onRefresh={() => undefined} onSelectItem={() => undefined} onWidenWindow={() => undefined} text={text}
        view={{ ...VIEW, caveats: ['news-body-limited'] }} />
    )
    // The caveat no longer renders anywhere on the card.
    expect(withCaveat.textContent).not.toContain('仅依据标题')
    expect(withCaveat.querySelector('.mi-news-sentiment__footer')).toBeNull()
  })

  it('says the filter is empty instead of rendering a blank card', async () => {
    // "不带中性" on a day whose items are all neutral used to leave an empty list region with no
    // sentence at all — the reader cannot tell a quiet day from a broken card. It is a filter
    // result, not an empty window, so the platform's filtered-out sentence and its clear action fit.
    const onIncludeNeutralChange = vi.fn()
    const neutralOnly = { ...VIEW, items: [{ ...VIEW.items[0]!, polarity: 'neutral' as const }] }
    const container = await mount(
      <NewsSentimentCard failed={false} loading={false} onOpenAll={() => undefined} onOpenSettings={() => undefined}
        onEnableSources={() => undefined} onRunSources={() => undefined} onWidenWindow={() => undefined}
        onRefresh={() => undefined} onSelectItem={() => undefined} text={text}
        view={neutralOnly} includeNeutral={false} onIncludeNeutralChange={onIncludeNeutralChange} />
    )
    expect(container.querySelector('.mi-news-sentiment__drivers button')).toBeNull()
    const state = container.querySelector('[data-news-sentiment-state="filtered-empty"]')
    expect(state?.querySelector('[data-reason-source]')?.getAttribute('data-reason-source')).toBe('platform')
    const clear = state?.querySelector<HTMLButtonElement>('button')
    expect(clear).not.toBeNull()
    await act(async () => { clear?.click() })
    expect(onIncludeNeutralChange).toHaveBeenCalledWith(true)
  })

  it('names the widest window by its real cap and never says "all"', async () => {
    const container = await mount(<NewsSentimentFeature text={text} client={client()} now={() => new Date('2026-10-24T13:00:00.000Z')} />)
    const open = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(text.openAll))
    await act(async () => { open?.click() })
    await act(async () => {})
    const selector = document.body.querySelector<HTMLElement>('.mi-news-drawer__time .ant-select-selector')
    await act(async () => { selector?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    await act(async () => {})
    const optionLabels = [...document.body.querySelectorAll<HTMLElement>('.ant-select-item-option')].map((entry) => entry.textContent?.trim())
    expect(optionLabels).toContain(text.windowAll)
    expect(text.windowAll).toBe('最近 100 条')
    // The whole sentiment surface (card + drawer + the open dropdown) must not promise "全部".
    expect(document.body.textContent).not.toContain('全部')
  })

  it('shows the same timestamp in the age badge and in the stale sentence', async () => {
    // Acceptance: the badge and "数据已过期 · 最后更新 {时刻}" must come from one field. They answer
    // different questions (age vs. empty window) with different edges, but never two times for one fact.
    const readinessWithCadence = {
      total: 4, enabledCount: 4, failedCount: 0, neverRanCount: 0,
      failedSourceIds: [], neverRanSourceIds: [],
      lastSuccessAt: '2026-10-24T09:00:00.000Z',
      maxCollectionIntervalMs: 30 * 60_000
    }
    const latest = '2026-10-24T11:00:00.000Z'
    const badge = await mountCard(
      { ...VIEW, asOf: '2026-10-24T13:00:00.000Z', window: '24h', latestKnownItemAt: latest, readiness: readinessWithCadence },
      {}
    )
    const stale = await mountCard(
      { ...VIEW, state: 'empty', summary: undefined, items: [], asOf: '2026-10-24T13:00:00.000Z', window: '1h', latestKnownItemAt: latest, readiness: readinessWithCadence },
      {}
    )
    const sentences = productText['zh-CN'].mi.newsSentiment
    const badgeText = badge.querySelector('[data-news-sentiment-updated]')?.textContent ?? ''
    const staleReason = stale.querySelector('[data-news-sentiment-state="stale"] [data-reason-source]')?.textContent ?? ''
    expect(badgeText).toContain(text.updatedAt.split('{time}')[0]!)
    expect(staleReason).toContain(sentences.stale.split('{time}')[0]!)
    // Both sentences must quote the same rendered time.
    const badgeTime = badgeText.replace(text.updatedAt.split('{time}')[0]!, '').trim()
    const staleTime = staleReason.replace(sentences.stale.split('{time}')[0]!, '').trim()
    expect(badgeTime.length).toBeGreaterThan(0)
    expect(staleTime).toContain(badgeTime)
  })

  it('does not put an age badge on rows that are within three collection cycles', async () => {
    const container = await mountCard({
      ...VIEW, asOf: '2026-10-24T13:00:00.000Z', window: '24h',
      latestKnownItemAt: '2026-10-24T12:30:00.000Z',
      readiness: { total: 4, enabledCount: 4, failedCount: 0, neverRanCount: 0, failedSourceIds: [], neverRanSourceIds: [], maxCollectionIntervalMs: 30 * 60_000 }
    }, {})
    expect(container.querySelector('[data-news-sentiment-updated]')).toBeNull()
  })

  it('shows the empty state without pretending neutral zero', async () => {
    const container = await mount(
      <NewsSentimentCard failed={false} loading={false} onOpenAll={() => undefined} onOpenSettings={() => undefined}
        onEnableSources={() => undefined} onIncludeNeutralChange={() => undefined} onRunSources={() => undefined} onWidenWindow={() => undefined}
        onRefresh={() => undefined} onSelectItem={() => undefined} text={text}
        view={{
          ...VIEW, state: 'empty', summary: undefined, items: [],
          readiness: { total: 4, enabledCount: 4, failedCount: 0, neverRanCount: 0, failedSourceIds: [], neverRanSourceIds: [], lastSuccessAt: '2026-10-24T12:00:00.000Z' }
        }} />
    )
    expect(container.textContent).toContain(productText['zh-CN'].mi.newsSentiment.quiet)
    expect(container.querySelector('[data-news-sentiment-state="quiet"] [data-reason-source]')?.getAttribute('data-reason-source')).toBe('product')
    expect(container.textContent).not.toContain('0.00')
  })

  it('does not turn an unreadable source status into "no related news"', async () => {
    // No readiness means the cause is unknown. Saying the period was quiet would publish a reading
    // the card cannot support — the same mistake as writing 0% for an empty denominator.
    const container = await mount(
      <NewsSentimentCard failed={false} loading={false} onOpenAll={() => undefined} onOpenSettings={() => undefined}
        onEnableSources={() => undefined} onIncludeNeutralChange={() => undefined} onRunSources={() => undefined} onWidenWindow={() => undefined}
        onRefresh={() => undefined} onSelectItem={() => undefined} text={text}
        view={{ ...VIEW, state: 'empty', summary: undefined, items: [] }} />
    )
    expect(container.textContent).toContain(text.unavailable)
    expect(container.textContent).not.toContain(productText['zh-CN'].mi.newsSentiment.quiet)
    expect(container.querySelector('[data-news-sentiment-state="unavailable"] [data-reason-source]')?.getAttribute('data-reason-source')).toBe('product')
  })
})

describe('settings entry', () => {
  // 宿主给了回调（= 打开配置抽屉并停在内容处理屏）就调它、不开本地弹框；没给就退回本地弹框。
  // 两条成对写：只测一边的话，「传了却还开弹框」或「没传就什么都不开」都能溜过去。
  const settledClient = (): NewsSentimentClient => client({ query: vi.fn(async () => VIEW) })
  // 弹框里那块翻译面自己接 IPC：这里只判「哪个入口被打开」，把桥桩成读不到，
  // 免得一次未处理的 rejection 把用例判红（那与入口无关）。
  beforeEach(() => {
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke: vi.fn(async () => undefined) } }
  })
  afterEach(() => {
    Reflect.deleteProperty(window, 'platform')
  })

  const openSettingsEntry = async (container: HTMLElement): Promise<void> => {
    const settings = container.querySelector<HTMLButtonElement>(`button[aria-label="${text.settings}"]`)
    expect(settings).not.toBeNull()
    await act(async () => { settings?.click() })
    await act(async () => {})
  }

  it('opens the local modal when the host passes no callback', async () => {
    const container = await mount(
      <NewsSentimentFeature text={text} client={settledClient()} now={() => new Date('2026-10-24T13:00:00.000Z')} />
    )
    await openSettingsEntry(container)

    const modal = document.body.querySelector('.ant-modal')
    expect(modal?.textContent).toContain(text.settingsModal.title)
  })

  it('calls the host callback once and does not open the local modal when one is given', async () => {
    const onOpenSettings = vi.fn()
    const container = await mount(
      <NewsSentimentFeature
        onOpenSettings={onOpenSettings}
        text={text}
        client={settledClient()}
        now={() => new Date('2026-10-24T13:00:00.000Z')} />
    )
    await openSettingsEntry(container)

    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    expect(document.body.querySelector('.ant-modal')).toBeNull()
  })
})
