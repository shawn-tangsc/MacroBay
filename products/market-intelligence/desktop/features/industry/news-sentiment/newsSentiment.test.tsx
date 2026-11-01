// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { NewsSentimentView } from '../../../../service/intelligence/news-sentiment/newsSentimentQuery'
import type { NewsSentimentSettingsView } from '../../../../service/intelligence/schema/newsSentiment'
import { productText } from '../../../shared/i18n/productText'
import type { NewsSentimentClient } from '../../../shared/ipc/newsSentimentClient'
import { NewsSentimentFeature } from './NewsSentimentFeature'
import { NewsSentimentCard } from './NewsSentimentCard'

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
      ruleId: 'news.delisting.v1', caveats: []
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
    getItem: vi.fn(async () => ({ ...VIEW.items[0]!, bodyExcerpt: 'The SEC approved options.' })),
    getSettings: vi.fn(async () => SETTINGS),
    saveSettings: vi.fn(async () => SETTINGS),
    rescore: vi.fn(async () => ({ queued: true })),
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
  const mountCard = (view: NewsSentimentView, props: Partial<Parameters<typeof NewsSentimentCard>[0]> = {}) =>
    mount(
      <NewsSentimentCard failed={false} loading={false} onOpenAll={() => undefined} onOpenSettings={() => undefined}
        onRefresh={props.onRefresh ?? (() => undefined)} onSelectItem={() => undefined} text={text} view={view} {...props} />
    )

  it('tells the five no-rows situations apart, each with its own next step', async () => {
    const onOpenSources = vi.fn()
    const onRunSources = vi.fn()
    const onRefresh = vi.fn()

    const disabled = await mountCard(emptyView({ readiness: readiness({ enabledCount: 0 }) }), { onOpenSources })
    const failed = await mountCard(emptyView({ readiness: readiness({ failedCount: 4, failedSourceIds: ['sec-rss', 'coindesk-rss', 'binance-announcements', 'okx-latest-announcements'] }) }), { onRunSources })
    const neverRan = await mountCard(emptyView({ readiness: readiness({ neverRanCount: 4, neverRanSourceIds: ['sec-rss'] }) }), { onRunSources })
    const stale = await mountCard(emptyView({ readiness: readiness(), latestKnownItemAt: '2026-10-24T09:00:00.000Z' }), { onRefresh })
    const quiet = await mountCard(emptyView({ readiness: readiness() }))

    const sentences = [
      text.emptyStates.sourcesDisabled,
      text.emptyStates.collectionFailed,
      text.emptyStates.neverRan,
      text.emptyStates.stale.replace('{time}', ''),
      text.emptyStates.quiet
    ]
    expect(new Set(sentences).size).toBe(5)

    expect(disabled.textContent).toContain(text.emptyStates.sourcesDisabled)
    expect(failed.textContent).toContain(text.emptyStates.collectionFailed)
    expect(neverRan.textContent).toContain(text.emptyStates.neverRan)
    // The stale sentence carries the time of the newest judgment on record, not just the label.
    expect(stale.textContent).toContain(text.emptyStates.stale.split('{time}')[0]!)
    expect(stale.textContent).not.toContain(text.emptyStates.quiet)
    expect(quiet.textContent).toContain(text.emptyStates.quiet)

    // Every state shares one class and differs by text + data attribute: nothing here is colour-only.
    for (const [container, kind] of [[disabled, 'sources-disabled'], [failed, 'collection-failed'], [neverRan, 'never-ran'], [stale, 'stale'], [quiet, 'quiet']] as const) {
      expect(container.querySelector(`[data-news-sentiment-state="${kind}"]`)?.className).toBe('mi-news-sentiment__state')
    }
    // The one state that is a fact rather than a fault offers no action.
    expect(quiet.querySelector('[data-news-sentiment-state="quiet"] button')).toBeNull()

    const click = async (container: HTMLElement) => {
      const button = container.querySelector<HTMLButtonElement>('.mi-news-sentiment__state button')
      await act(async () => { button?.click() })
    }
    await click(disabled)
    await click(failed)
    await click(neverRan)
    await click(stale)
    expect(onOpenSources).toHaveBeenCalledTimes(1)
    expect(onRunSources).toHaveBeenNthCalledWith(1, ['sec-rss', 'coindesk-rss', 'binance-announcements', 'okx-latest-announcements'])
    expect(onRunSources).toHaveBeenNthCalledWith(2, ['sec-rss'])
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('does not call an empty read "quiet" when the sources never ran', async () => {
    const container = await mountCard(emptyView({ readiness: readiness({ neverRanCount: 4 }) }))
    expect(container.textContent).not.toContain(text.emptyStates.quiet)
    expect(container.textContent).toContain(text.emptyStates.neverRan)
  })
})

describe('NewsSentimentFeature', () => {
  it('shows the summary and the top drivers', async () => {
    const container = await mount(<NewsSentimentFeature text={text} client={client()} now={() => new Date('2026-10-24T13:00:00.000Z')} />)
    expect(container.querySelector('[data-news-sentiment-card]')?.textContent).toContain('偏多')
    expect(container.querySelectorAll('.mi-news-sentiment__drivers button')).toHaveLength(2)
    expect(container.textContent).toContain('SEC Approves Spot Ethereum ETF Options')
  })

  it('opens the drawer and lists every item', async () => {
    const container = await mount(<NewsSentimentFeature text={text} client={client()} now={() => new Date('2026-10-24T13:00:00.000Z')} />)
    const open = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(text.openAll))
    await act(async () => { open?.click() })
    await act(async () => {})
    expect(document.body.textContent).toContain('Binance Will Delist XYZ Perpetual')
    expect(document.body.querySelectorAll('.mi-news-drawer__row')).toHaveLength(2)
  })


  it('switches the detail when another row is clicked', async () => {
    const getItem = vi.fn(async (input: { itemId: string }) => {
      const item = VIEW.items.find((entry) => entry.itemId === input.itemId)!
      return { ...item, bodyExcerpt: `body:${item.itemId}` }
    })
    const container = await mount(<NewsSentimentFeature text={text} client={client({ getItem })} now={() => new Date('2026-10-24T13:00:00.000Z')} />)
    const open = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(text.openAll))
    await act(async () => { open?.click() })
    await act(async () => {})
    const rows = [...document.body.querySelectorAll<HTMLButtonElement>('.mi-news-drawer__row')]
    await act(async () => { rows[1]?.click() })
    await act(async () => {})
    expect(document.body.querySelector('.mi-news-drawer__detail h3')?.textContent).toContain('Binance Will Delist XYZ Perpetual')
    expect(document.body.querySelector('.mi-news-drawer__bodytext')?.textContent).toContain('body:item-b')
  })


  it('does not snap back to the card focus target after a row click', async () => {
    const getItem = vi.fn(async (input: { itemId: string }) => {
      const item = VIEW.items.find((entry) => entry.itemId === input.itemId)!
      return { ...item, bodyExcerpt: `body:${item.itemId}` }
    })
    const container = await mount(<NewsSentimentFeature text={text} client={client({ getItem })} now={() => new Date('2026-10-24T13:00:00.000Z')} />)
    const cardItems = [...container.querySelectorAll<HTMLButtonElement>('.mi-news-sentiment__drivers button')]
    await act(async () => { cardItems[1]?.click() })
    await act(async () => {})
    const rows = [...document.body.querySelectorAll<HTMLButtonElement>('.mi-news-drawer__row')]
    await act(async () => { rows[0]?.click() })
    await act(async () => {})
    expect(document.body.querySelector('.mi-news-drawer__detail h3')?.textContent).toContain('SEC Approves Spot Ethereum ETF Options')
  })


  it('does not show the previous article body when the next detail read fails', async () => {
    // The detail panel kept the last successful read while the new one was in flight and after it
    // failed, so row B's heading sat above row A's body text.
    const getItem = vi.fn(async (input: { itemId: string }) => {
      if (input.itemId === 'item-b') throw new Error('detail read failed')
      const item = VIEW.items.find((entry) => entry.itemId === input.itemId)!
      return { ...item, bodyExcerpt: `body:${item.itemId}` }
    })
    const container = await mount(<NewsSentimentFeature text={text} client={client({ getItem })} now={() => new Date('2026-10-24T13:00:00.000Z')} />)
    const open = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(text.openAll))
    await act(async () => { open?.click() })
    await act(async () => {})
    expect(document.body.querySelector('.mi-news-drawer__bodytext')?.textContent).toContain('body:item-a')
    const rows = [...document.body.querySelectorAll<HTMLButtonElement>('.mi-news-drawer__row')]
    await act(async () => { rows[1]?.click() })
    await act(async () => {})
    const body = document.body.querySelector('.mi-news-drawer__bodytext')?.textContent ?? ''
    expect(body).not.toContain('body:item-a')
    expect(body).toContain(text.unavailable)
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
    const exclude = [...container.querySelectorAll<HTMLButtonElement>('.mi-news-sentiment__neutral-filter button')]
      .find((button) => button.textContent?.includes(text.neutralFilter.exclude))
    await act(async () => { exclude?.click() })
    await act(async () => {})
    expect(container.querySelectorAll('.mi-news-sentiment__drivers button')).toHaveLength(2)
    expect(exclude?.getAttribute('aria-pressed')).toBe('true')
  })

  it('drops the card-wide engine badge and hides the empty footer', async () => {
    // The footer badge said "Rules" whenever any item was scored by the rule engine. It named no
    // item and looked like a control that did nothing, so the card no longer shows it.
    const container = await mount(
      <NewsSentimentCard failed={false} loading={false} onOpenAll={() => undefined} onOpenSettings={() => undefined}
        onRefresh={() => undefined} onSelectItem={() => undefined} text={text} view={VIEW} />
    )
    expect(container.textContent).not.toContain(text.engine.rules)
    expect(container.querySelector('.mi-news-sentiment__footer')).toBeNull()

    // The caveat is still worth a line, and it is the only thing the footer carries now.
    const withCaveat = await mount(
      <NewsSentimentCard failed={false} loading={false} onOpenAll={() => undefined} onOpenSettings={() => undefined}
        onRefresh={() => undefined} onSelectItem={() => undefined} text={text}
        view={{ ...VIEW, caveats: ['news-body-limited'] }} />
    )
    expect(withCaveat.querySelector('.mi-news-sentiment__footer')?.textContent).toBe(text.bodyLimited)
    expect(withCaveat.textContent).not.toContain(text.engine.rules)
  })

  it('says the filter is empty instead of rendering a blank card', async () => {
    // "不带中性" on a day whose items are all neutral used to leave an empty list region with no
    // sentence at all — the reader cannot tell a quiet day from a broken card.
    const neutralOnly = { ...VIEW, items: [{ ...VIEW.items[0]!, polarity: 'neutral' as const }] }
    const container = await mount(
      <NewsSentimentCard failed={false} loading={false} onOpenAll={() => undefined} onOpenSettings={() => undefined}
        onRefresh={() => undefined} onSelectItem={() => undefined} text={text}
        view={neutralOnly} includeNeutral={false} onIncludeNeutralChange={() => undefined} />
    )
    expect(container.querySelector('.mi-news-sentiment__drivers button')).toBeNull()
    expect(container.querySelector('[data-news-sentiment-state="filtered-empty"]')?.textContent)
      .toContain(text.drawer.emptyFiltered)
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

  it('shows the empty state without pretending neutral zero', async () => {
    const container = await mount(
      <NewsSentimentCard failed={false} loading={false} onOpenAll={() => undefined} onOpenSettings={() => undefined}
        onRefresh={() => undefined} onSelectItem={() => undefined} text={text}
        view={{
          ...VIEW, state: 'empty', summary: undefined, items: [],
          readiness: { total: 4, enabledCount: 4, failedCount: 0, neverRanCount: 0, failedSourceIds: [], neverRanSourceIds: [], lastSuccessAt: '2026-10-24T12:00:00.000Z' }
        }} />
    )
    expect(container.textContent).toContain(text.emptyStates.quiet)
    expect(container.textContent).not.toContain('0.00')
  })

  it('does not turn an unreadable source status into "no related news"', async () => {
    // No readiness means the cause is unknown. Saying the period was quiet would publish a reading
    // the card cannot support — the same mistake as writing 0% for an empty denominator.
    const container = await mount(
      <NewsSentimentCard failed={false} loading={false} onOpenAll={() => undefined} onOpenSettings={() => undefined}
        onRefresh={() => undefined} onSelectItem={() => undefined} text={text}
        view={{ ...VIEW, state: 'empty', summary: undefined, items: [] }} />
    )
    expect(container.textContent).toContain(text.unavailable)
    expect(container.textContent).not.toContain(text.emptyStates.quiet)
    expect(container.querySelector('[data-news-sentiment-state="unavailable"]')).toBeTruthy()
  })
})
