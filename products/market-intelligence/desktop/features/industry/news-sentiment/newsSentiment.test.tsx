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

  it('shows the empty state without pretending neutral zero', async () => {
    const container = await mount(
      <NewsSentimentCard failed={false} loading={false} onOpenAll={() => undefined} onOpenSettings={() => undefined}
        onRefresh={() => undefined} onSelectItem={() => undefined} onWindowChange={() => undefined} text={text}
        view={{ ...VIEW, state: 'empty', summary: undefined, items: [] }} window="24h" />
    )
    expect(container.textContent).toContain(text.empty)
    expect(container.textContent).not.toContain('0.00')
  })
})
