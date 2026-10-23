// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { INTELLIGENCE_PUBLIC_QUERY_METHODS } from '../../../contracts/intelligencePublicQueryMethods'
import { intelligenceFearGreedClient } from './intelligenceFearGreedClient'

const asOf = '2026-08-06T12:00:00.000Z'

afterEach(() => vi.unstubAllGlobals())

describe('intelligenceFearGreedClient', () => {
  it('invokes only the fixed snapshot method and rebuilds the compact result', async () => {
    const invoke = vi.fn(async () => ({ state: 'available', asOf, score: 22, bucket: 'extreme-fear', observedAt: '2026-08-06T10:00:00.000Z' }))
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    await expect(intelligenceFearGreedClient.querySnapshot({ asOf })).resolves.toEqual({ state: 'available', asOf, score: 22, bucket: 'extreme-fear', observedAt: '2026-08-06T10:00:00.000Z' })
    expect(invoke).toHaveBeenCalledWith('market-intelligence', INTELLIGENCE_PUBLIC_QUERY_METHODS.queryFearGreedSnapshot, { asOf })
  })

  it.each([
    ['a malformed input', { asOf: '2026-08-06T12:00:00Z' }],
    ['an extension result', { asOf }]
  ])('fails closed for %s', async (_name, input) => {
    const invoke = vi.fn(async () => ({ state: 'available', asOf, score: 22, bucket: 'extreme-fear', observedAt: '2026-08-06T10:00:00.000Z', sourceUrl: 'https://secret.example.test' }))
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    await expect(intelligenceFearGreedClient.querySnapshot(input as never)).resolves.toEqual({ state: 'unavailable', failureCode: 'fear-greed-query-unavailable' })
    if (_name === 'a malformed input') expect(invoke).not.toHaveBeenCalled()
  })

  it.each([
    ['a getPrototypeOf trap', new Proxy({}, { getPrototypeOf: () => { throw new Error('secret') } })],
    ['an ownKeys trap', new Proxy({}, { ownKeys: () => { throw new Error('secret') } })],
    ['a descriptor trap', new Proxy({ asOf }, { getOwnPropertyDescriptor: () => { throw new Error('secret') } })],
    ['a getter trap', new Proxy({ asOf }, { get: () => { throw new Error('secret') } })],
    ['an accessor input', Object.defineProperty({}, 'asOf', { enumerable: true, get: () => asOf })],
    ['a symbol-bearing input', { asOf, [Symbol('secret')]: true }]
  ])('resolves unavailable for %s without calling the bridge', async (_name, input) => {
    const invoke = vi.fn()
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    await expect(intelligenceFearGreedClient.querySnapshot(input as never)).resolves.toEqual({ state: 'unavailable', failureCode: 'fear-greed-query-unavailable' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it.each([
    ['an accessor bridge result', Object.defineProperty({}, 'state', { enumerable: true, get: () => { throw new Error('secret') } })],
    ['a symbol-bearing bridge result', { state: 'unavailable', failureCode: 'fear-greed-query-unavailable', [Symbol('secret')]: true }],
    ['an ownKeys-trapping bridge result', new Proxy({}, { ownKeys: () => { throw new Error('secret') } })],
    ['a descriptor-trapping bridge result', new Proxy({ state: 'unavailable' }, { getOwnPropertyDescriptor: () => { throw new Error('secret') } })],
    ['a getter-trapping bridge result', new Proxy({ state: 'unavailable', failureCode: 'fear-greed-query-unavailable' }, { get: () => { throw new Error('secret') } })]
  ])('resolves unavailable for %s without leaking the trap', async (_name, result) => {
    const invoke = vi.fn(async () => result)
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    await expect(intelligenceFearGreedClient.querySnapshot({ asOf })).resolves.toEqual({ state: 'unavailable', failureCode: 'fear-greed-query-unavailable' })
  })
})
