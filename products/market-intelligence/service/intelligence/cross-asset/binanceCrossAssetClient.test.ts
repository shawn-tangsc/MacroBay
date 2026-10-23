import { describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

import { createBinanceCrossAssetClient } from './binanceCrossAssetClient'
import { createSourceRequestGovernanceQueue } from '../application/sourceRequestGovernance'

// Derived contract cases, not provider admission evidence. UTC 5m boundary.
const openMs = 1_700_000_100_000
const endMs = openMs + 300_000
const row = () => [openMs, '100', '101', '99', '100.5', '12', endMs - 1, 'ignored']
const json = (value: unknown) => new Response(JSON.stringify(value), {headers:{'content-type':'application/json'}})
const queue = () => createSourceRequestGovernanceQueue({now:Date.now})

describe('binance cross-asset client', () => {
  it('records the verified upstream limits separately from the stricter product budget', () => {
    const admission = JSON.parse(readFileSync(new URL('./fixtures/binance-cross-asset-admission.json', import.meta.url), 'utf8'))
    expect(admission.upstreamLimits).toMatchObject({ klineMaximumRows: 1500, websocketMaximumStreams: 1024, websocketIncomingMessagesPerSecond: 10, websocketLifetimeHours: 24 })
  })

  it('accepts the synthetic metadata and REST projections for all three admitted assets', async () => {
    const admission = JSON.parse(readFileSync(new URL('./fixtures/binance-cross-asset-admission.json', import.meta.url), 'utf8'))
    const samples = JSON.parse(readFileSync(new URL('./fixtures/binance-cross-asset-samples.json', import.meta.url), 'utf8'))
    const gate = queue()
    const client = createBinanceCrossAssetClient({ requestGovernanceQueue: gate, platformFetch: async input => {
      const url = new URL(input)
      if (url.pathname.endsWith('exchangeInfo')) return json({ symbols: admission.assets.map((asset: { tickSize: string }) => ({ ...asset, filters: [{ filterType: 'PRICE_FILTER', tickSize: asset.tickSize }] })) })
      return json(samples.rest[url.searchParams.get('symbol')!].map((bar: Record<string, unknown>) => [bar.barOpenMs, bar.open, bar.high, bar.low, bar.close, bar.volume, Number(bar.barEndMs) - 1]))
    } })
    try {
      expect((await client.fetchMetadata()).map(asset => asset.state)).toEqual(['admitted', 'admitted', 'admitted'])
      for (const asset of admission.assets) {
        const bars = samples.rest[asset.symbol]
        expect(await client.fetchClosedBars({ asset: asset.asset, endMs: bars.at(-1).barEndMs, limit: 2 })).toEqual(bars)
      }
    } finally { gate.close() }
  })

  it('respects disabled-source governance for production while allowing an explicit configuration test', async () => {
    const gate = queue(); gate.disableSource('binance-futures-positioning')
    const request = vi.fn(async () => json([]))
    const client = createBinanceCrossAssetClient({ platformFetch: request, requestGovernanceQueue: gate })
    try {
      await expect(client.fetchClosedBars({ asset: 'btc', endMs, limit: 1 })).rejects.toThrow('response-unavailable')
      expect(request).not.toHaveBeenCalled()
      expect(await client.fetchClosedBars({ asset: 'btc', endMs, limit: 1 }, { intent: 'user' } as never)).toEqual([])
      expect(request).toHaveBeenCalledOnce()
    } finally { gate.close() }
  })
  it('starts the HTTP deadline only after governed dispatch, not while waiting for quota', async () => {
    vi.useFakeTimers()
    const gate = queue()
    const request = vi.fn(async () => json([]))
    const client = createBinanceCrossAssetClient({ platformFetch: request, requestGovernanceQueue: gate })
    try {
      for (let index = 0; index < 12; index++) await client.fetchClosedBars({ asset: 'btc', endMs, limit: 1 })
      let outcome = 'waiting'
      const pending = client.fetchClosedBars({ asset: 'btc', endMs, limit: 1 }).then(() => { outcome = 'success' }, () => { outcome = 'failed' })
      await vi.advanceTimersByTimeAsync(15_001)
      expect(outcome).toBe('waiting')
      await vi.advanceTimersByTimeAsync(44_999)
      await pending
      expect(outcome).toBe('success')
      expect(request).toHaveBeenCalledTimes(13)
    } finally { gate.close(); vi.useRealTimers() }
  })
  it('keeps all feature production imports inside Market Intelligence or approved platform boundaries', () => {
    const directory = fileURLToPath(new URL('.', import.meta.url))
    for (const file of readdirSync(directory).filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts'))) {
      const source = readFileSync(join(directory, file), 'utf8')
      const imports = [...source.matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g)].map(match => match[1])
      expect(imports.filter(path => /(?:^|\/)products\/|marketData|binanceCandle/.test(path)), file).toEqual([])
      expect(source, file).not.toMatch(/globalThis\.(?:fetch|WebSocket)|new\s+WebSocket\s*\(/)
    }
  })
  it('pages backwards with at most 2017 closed bars and three governed requests', async () => {
    const request = vi.fn(async (input: string) => {
      const url = new URL(input)
      const limit = Number(url.searchParams.get('limit'))
      const end = Number(url.searchParams.get('endTime')) + 1
      return json(Array.from({ length: limit }, (_, index) => {
        const start = end - (limit - index) * 300_000
        return [start, '100', '101', '99', '100.5', '12', start + 299_999]
      }))
    })
    const client = createBinanceCrossAssetClient({ platformFetch: request, requestGovernanceQueue: queue() })
    const pages = []
    for await (const page of client.fetchHistory({ asset: 'proxy', endMs })) pages.push(page)
    expect(pages.map(page => page.length)).toEqual([1000, 1000, 17])
    expect(request).toHaveBeenCalledTimes(3)
    expect(pages[1].at(-1)?.barEndMs).toBe(pages[0][0].barOpenMs)
    expect(pages[2].at(-1)?.barEndMs).toBe(pages[1][0].barOpenMs)
  })

  it('stops paginating on empty history and rejects caller range injection', async () => {
    const request = vi.fn(async () => json([]))
    const client = createBinanceCrossAssetClient({ platformFetch: request, requestGovernanceQueue: queue() })
    const pages = []
    for await (const page of client.fetchHistory({ asset: 'eth', endMs })) pages.push(page)
    expect(pages).toEqual([])
    expect(request).toHaveBeenCalledOnce()
    const iterator = client.fetchHistory({ asset: 'eth', endMs, startTime: 0 } as never)
    await expect(iterator.next()).rejects.toThrow('invalid-request')
    expect(request).toHaveBeenCalledOnce()
  })

  it.each([[429, 'rate-limited', 2000], [418, 'request-banned', undefined]] as const)('preserves safe policy for HTTP %s without response text', async (status, code, retryAfterMs) => {
    const client = createBinanceCrossAssetClient({
      platformFetch: async () => new Response('private upstream diagnostic', { status, headers: { 'retry-after': '2' } }),
      requestGovernanceQueue: queue()
    })
    const failure = await client.fetchClosedBars({ asset: 'proxy', endMs, limit: 1 }).catch(error => error)
    expect(failure).toMatchObject({ code, retryAfterMs })
    expect(JSON.stringify(failure)).not.toContain('private')
    expect(failure.message).toBe(code)
  })

  it.each([undefined, 'invalid', '-2'])('uses the named 60s fallback for invalid Retry-After %s', async retryAfter => {
    const client = createBinanceCrossAssetClient({
      platformFetch: async () => new Response(null, { status: 429, headers: retryAfter === undefined ? {} : { 'retry-after': retryAfter } }),
      requestGovernanceQueue: queue()
    })
    await expect(client.fetchClosedBars({ asset: 'btc', endMs, limit: 1 })).rejects.toMatchObject({ code: 'rate-limited', retryAfterMs: 60_000 })
  })

  it('rejects duplicate or descending bar identities within a page', async () => {
    const previous = [openMs - 300_000, '100', '101', '99', '100.5', '12', openMs - 1]
    for (const rows of [[row(), row()], [row(), previous]]) {
      const client = createBinanceCrossAssetClient({ platformFetch: async () => json(rows), requestGovernanceQueue: queue() })
      await expect(client.fetchClosedBars({ asset: 'proxy', endMs, limit: 2 })).rejects.toThrow('invalid-response')
    }
  })

  it('projects fixed QQQUSDT-proxy/BTC/ETH 5m klines through the injected platform transport', async () => {
    const platformFetch = vi.fn(async () => new Response(JSON.stringify([[
      openMs, '100', '101', '99', '100.5', '12', endMs - 1, 'x', 3, 'x', 'x', 'x'
    ]]), { status: 200, headers: { 'content-type': 'application/json' } }))
    const client = createBinanceCrossAssetClient({ platformFetch, requestGovernanceQueue: queue() })

    const result = await client.fetchClosedBars({ asset: 'proxy', endMs, limit: 1 })

    expect(platformFetch).toHaveBeenCalledOnce()
    expect(platformFetch).toHaveBeenCalledWith(expect.stringContaining('/fapi/v1/klines?symbol=QQQUSDT&interval=5m'), expect.objectContaining({method:'GET',redirect:'error'}))
    expect(result).toEqual([{ symbol: 'QQQUSDT', barOpenMs: openMs, barEndMs: endMs, open: '100', high: '101', low: '99', close: '100.5', volume: '12' }])
  })

  it('rejects caller symbols without a request', async () => {
    const platformFetch = vi.fn()
    const client = createBinanceCrossAssetClient({ platformFetch, requestGovernanceQueue: queue() })
    await expect(client.fetchClosedBars({ asset: 'proxy', endMs, limit: 1, symbol: 'DOGEUSDT' } as never)).rejects.toThrow('invalid-request')
    expect(platformFetch).not.toHaveBeenCalled()
  })

  it('has no request fallback when the shared queue is absent or closed', async () => {
    const platformFetch = vi.fn(async () => json([row()]))
    const missing = createBinanceCrossAssetClient({platformFetch} as never)
    await expect(missing.fetchClosedBars({asset:'btc',endMs,limit:1})).rejects.toThrow('dependency-unavailable')
    const closed = queue(); closed.close()
    await expect(createBinanceCrossAssetClient({platformFetch,requestGovernanceQueue:closed}).fetchClosedBars({asset:'btc',endMs,limit:1})).rejects.toThrow()
    expect(platformFetch).not.toHaveBeenCalled()
  })

  it.each(['unaligned', 'future', 'bad-close', 'zero', 'whitespace', 'ohlc', 'negative-volume'])('rejects %s bars instead of silently skipping them', async kind => {
    const input = row()
    if(kind==='unaligned'){input[0]=openMs+1;input[6]=endMs}
    if(kind==='future'){input[0]=endMs;input[6]=endMs+299999}
    if(kind==='bad-close')input[6]=endMs
    if(kind==='zero')input[4]='0'
    if(kind==='whitespace')input[4]=' 100 '
    if(kind==='ohlc')input[4]='102'
    if(kind==='negative-volume')input[5]='-1'
    const client = createBinanceCrossAssetClient({platformFetch:async()=>json([input]),requestGovernanceQueue:queue()})
    await expect(client.fetchClosedBars({asset:'proxy',endMs,limit:1})).rejects.toThrow('invalid-response')
  })

  it('rejects accessor input without invoking it', async () => {
    const getter=vi.fn(()=> 'proxy');const platformFetch=vi.fn()
    const input={get asset(){return getter()},endMs,limit:1}
    await expect(createBinanceCrossAssetClient({platformFetch,requestGovernanceQueue:queue()}).fetchClosedBars(input as never)).rejects.toThrow('invalid-request')
    expect(getter).not.toHaveBeenCalled();expect(platformFetch).not.toHaveBeenCalled()
  })

  it('cancels an oversized streamed body before draining its remainder', async () => {
    let pulls=0;const cancel=vi.fn()
    const body=new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(600_000));if(pulls===4)controller.close()},cancel})
    const client=createBinanceCrossAssetClient({platformFetch:async()=>new Response(body,{headers:{'content-type':'application/json'}}),requestGovernanceQueue:queue()})
    await expect(client.fetchClosedBars({asset:'eth',endMs,limit:1})).rejects.toThrow('response-too-large')
    expect(cancel).toHaveBeenCalledOnce();expect(pulls).toBeLessThan(4)
  })

  it('admits only the asset-specific contract type and projects tick precision', async () => {
    const metadata = { symbols: [
      {symbol:'QQQUSDT',baseAsset:'QQQ',quoteAsset:'USDT',marginAsset:'USDT',contractType:'TRADIFI_PERPETUAL',status:'TRADING',filters:[{filterType:'PRICE_FILTER',tickSize:'0.01000000'}],ignored:'advisory'},
      ...['BTC','ETH'].map(baseAsset=>({symbol:`${baseAsset}USDT`,baseAsset,quoteAsset:'USDT',marginAsset:'USDT',contractType:'PERPETUAL',status:'TRADING',filters:[{filterType:'PRICE_FILTER',tickSize:'0.10'}]}))
    ] }
    const request=vi.fn(async()=>json(metadata))
    const client=createBinanceCrossAssetClient({platformFetch:request,requestGovernanceQueue:queue()})
    expect(await client.fetchMetadata()).toEqual([
      {asset:'proxy',symbol:'QQQUSDT',state:'admitted',tickSize:'0.01000000',priceDecimals:2},
      {asset:'btc',symbol:'BTCUSDT',state:'admitted',tickSize:'0.10',priceDecimals:1},
      {asset:'eth',symbol:'ETHUSDT',state:'admitted',tickSize:'0.10',priceDecimals:1}
    ])
    metadata.symbols[1].contractType='TRADIFI_PERPETUAL'
    metadata.symbols[0].contractType='PERPETUAL'
    expect((await client.fetchMetadata()).map(x=>x.state)).toEqual(['unavailable','unavailable','admitted'])
    metadata.symbols.push(metadata.symbols[2])
    expect((await client.fetchMetadata())[2].state).toBe('unavailable')
  })

  it('settles the deadline even if injected transport ignores abort', async () => {
    vi.useFakeTimers()
    try {
      const client=createBinanceCrossAssetClient({platformFetch:()=>new Promise(()=>{}),requestGovernanceQueue:queue()})
      const assertion=expect(client.fetchClosedBars({asset:'btc',endMs,limit:1})).rejects.toThrow('request-timeout')
      await vi.advanceTimersByTimeAsync(15_000)
      await assertion
    } finally {vi.useRealTimers()}
  })

  it('cancels while queued before starting a request', async () => {
    const request=vi.fn(async()=>json([]));const gate=queue();const abort=new AbortController()
    const client=createBinanceCrossAssetClient({platformFetch:request,requestGovernanceQueue:gate})
    await Promise.all(Array.from({length:12},()=>client.fetchClosedBars({asset:'btc',endMs,limit:1})))
    const assertion=expect(client.fetchClosedBars({asset:'btc',endMs,limit:1},{signal:abort.signal})).rejects.toThrow('request-cancelled')
    abort.abort();await assertion;expect(request).toHaveBeenCalledTimes(12);gate.close()
  })
})
