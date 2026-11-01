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
    await new Promise((resolve) => setTimeout(resolve, 250))
    await act(async () => {})
    const tooltip = document.body.querySelector('.ant-tooltip')
    expect(tooltip?.textContent).toContain(text.settings)
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

  it('tells the five no-rows situations apart, each with its own next step', async () => {
    const onEnableSources = vi.fn()
    const onRunSources = vi.fn()
    const onRefresh = vi.fn()
    const onWidenWindow = vi.fn()
    const sentences = productText['zh-CN'].mi.newsSentiment

    const disabled = await mountCard(emptyView({ readiness: readiness({ enabledCount: 0 }) }), { onEnableSources })
    const failed = await mountCard(emptyView({ readiness: readiness({ failedCount: 4, failedSourceIds: ['sec-rss', 'coindesk-rss', 'binance-announcements', 'okx-latest-announcements'] }) }), { onRefresh })
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
    // A quiet period is a fact: no action, unlike the other four.
    expect(quiet.querySelector('[data-news-sentiment-state="quiet"] button')).toBeNull()

    const press = async (container: HTMLElement) => {
      const button = container.querySelector<HTMLButtonElement>('.mi-news-sentiment__state button')
      expect(button).not.toBeNull()
      await act(async () => { button?.click() })
    }
    await press(disabled)
    await press(failed)
    await press(neverRan)
    await press(stale)
    // Each action really does its own thing: open the settings drawer, re-read, run the missing
    // sources, widen the window. None of them is aliased to another.
    expect(onEnableSources).toHaveBeenCalledTimes(1)
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(onRunSources).toHaveBeenCalledWith(['sec-rss'])
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
    expect(container.querySelectorAll('.mi-news-sentiment__drivers button')).toHaveLength(2)
    expect(container.textContent).toContain('SEC Approves Spot Ethereum ETF Options')
  })

  it('opens the drawer and lists every item', async () => {
    const container = await mount(<NewsSentimentFeature text={text} client={client()} now={() => new Date('2026-10-24T13:00:00.000Z')} />)
    const open = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(text.openAll))
    await act(async () => { open?.click() })
    await act(async () => {})
    expect(document.body.textContent).toContain('Binance Will Delist XYZ Perpetual')
    expect(document.body.querySelectorAll('.mi-news-drawer__row-open')).toHaveLength(2)
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
    const getItem = vi.fn(async (input: { itemId: string }) => {
      const item = VIEW.items.find((entry) => entry.itemId === input.itemId)!
      return { ...item, bodyExcerpt: `body:${item.itemId}` }
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
    const exclude = [...container.querySelectorAll<HTMLElement>('.mi-news-sentiment__neutral-filter label')]
      .find((label) => label.textContent?.includes(text.neutralFilter.exclude))
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
      expect(item.querySelector('button.mi-news-drawer__row-open')).not.toBeNull()
    }

    const more = document.body.querySelector<HTMLButtonElement>(`button[aria-label="${text.drawer.moreActions}"]`)
    expect(more).not.toBeNull()
    await act(async () => { more?.click() })
    await act(async () => {})
    expect(document.body.querySelector('[role="menu"]')).not.toBeNull()
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
    const rows = [...document.body.querySelectorAll<HTMLButtonElement>('.mi-news-drawer__row-open')]
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
    const rows = [...document.body.querySelectorAll<HTMLButtonElement>('.mi-news-drawer__row-open')]
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
    const rows = [...document.body.querySelectorAll<HTMLButtonElement>('.mi-news-drawer__row-open')]
    await act(async () => { rows[1]?.click() })
    await act(async () => {})
    const body = document.body.querySelector('.mi-news-drawer__bodytext')?.textContent ?? ''
    expect(body).not.toContain('body:item-a')
    expect(body).toContain(text.unavailable)
  })

  it('keeps the neutral filter on the shared radio base, not a pressed-button pair', async () => {
    // 1a acceptance for the segmented class: role=radiogroup, native radios (one Tab stop per group,
    // arrow keys move within it), and no hand-written aria-pressed group anywhere on the card.
    const container = await mount(<NewsSentimentFeature text={text} client={client()} now={() => new Date('2026-10-24T13:00:00.000Z')} />)
    const group = container.querySelector('[role="radiogroup"]')
    expect(group).toBeTruthy()
    expect(group?.querySelectorAll('input[type="radio"]')).toHaveLength(2)
    expect(group?.querySelectorAll('input[type="radio"]:checked')).toHaveLength(1)
    expect(container.querySelectorAll('[aria-pressed]')).toHaveLength(0)
  })

  it('keeps the original/translated toggle on the shared radio base', async () => {
    const getItem = vi.fn(async (input: { itemId: string }) => {
      const item = VIEW.items.find((entry) => entry.itemId === input.itemId)!
      return { ...item, bodyExcerpt: `body:${item.itemId}`, translatedBodyExcerpt: '译文正文' }
    })
    const container = await mount(<NewsSentimentFeature text={text} client={client({ getItem })} now={() => new Date('2026-10-24T13:00:00.000Z')} />)
    const open = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(text.openAll))
    await act(async () => { open?.click() })
    await act(async () => {})
    const toggle = document.body.querySelector('.mi-news-drawer__body-toggle')
    expect(toggle?.getAttribute('role')).toBe('radiogroup')
    expect(toggle?.querySelectorAll('input[type="radio"]')).toHaveLength(2)
    expect(toggle?.querySelectorAll('input[type="radio"]:checked')).toHaveLength(1)
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
    // The action settles its own promise chain (enable -> collect -> re-read) before we assert.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    for (const sourceId of ['sec-rss', 'coindesk-rss', 'binance-announcements', 'okx-latest-announcements']) {
      expect(setEnabled).toHaveBeenCalledWith(sourceId, true)
      expect(runNow).toHaveBeenCalledWith(sourceId)
    }
    expect(query.mock.calls.length).toBeGreaterThan(1)
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
    const exclude = [...container.querySelectorAll<HTMLElement>('.mi-news-sentiment__neutral-filter label')]
      .find((label) => label.textContent?.includes(text.neutralFilter.exclude))
    await act(async () => { exclude?.click() })
    await act(async () => {})
    expect(container.querySelectorAll('.mi-news-sentiment__drivers button')).toHaveLength(2)
    expect(exclude?.querySelector('input')?.checked).toBe(true)
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
    // sentence at all — the reader cannot tell a quiet day from a broken card. It is a filter
    // result, not an empty window, so the platform's filtered-out sentence and its clear action fit.
    const onIncludeNeutralChange = vi.fn()
    const neutralOnly = { ...VIEW, items: [{ ...VIEW.items[0]!, polarity: 'neutral' as const }] }
    const container = await mount(
      <NewsSentimentCard failed={false} loading={false} onOpenAll={() => undefined} onOpenSettings={() => undefined}
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
        onRefresh={() => undefined} onSelectItem={() => undefined} text={text}
        view={{ ...VIEW, state: 'empty', summary: undefined, items: [] }} />
    )
    expect(container.textContent).toContain(text.unavailable)
    expect(container.textContent).not.toContain(productText['zh-CN'].mi.newsSentiment.quiet)
    expect(container.querySelector('[data-news-sentiment-state="unavailable"] [data-reason-source]')?.getAttribute('data-reason-source')).toBe('product')
  })
})
