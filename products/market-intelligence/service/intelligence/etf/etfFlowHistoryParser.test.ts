import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { hasObservedEtfFlowHistoryShape, parseEtfFlowHistoryResponse } from './etfFlowHistoryParser'

const btcFixture = readFileSync(join(__dirname, '../adapters/fixtures/zeroxrouter-btc-flow-history-structural.json'), 'utf8')
const ethFixture = readFileSync(join(__dirname, '../adapters/fixtures/zeroxrouter-eth-flow-history-structural.json'), 'utf8')

describe('ETF flow-history parser', () => {
  it.each([['BTC', btcFixture], ['ETH', ethFixture]])('parses the authorized %s structural projection without retaining provider text', (_asset, body) => {
    expect(hasObservedEtfFlowHistoryShape(body)).toBe(true)
    expect(parseEtfFlowHistoryResponse(body)).toMatchObject({
      state: 'available',
      rows: expect.arrayContaining([
        expect.objectContaining({ date: expect.any(Number), changeUsd: expect.any(Number) })
      ])
    })
  })

  it('accepts an optional opaque numeric update marker and metadata-only ticker children', () => {
    const body = JSON.stringify({
      code: 200,
      msg: 'redacted',
      data: [{
        date: 1_700_000_000_000,
        change: 1,
        changeUsd: 2,
        updateTime: 1_700_000_000_001,
        list: [{ name: 'example', ticker: 'EXAMPLE' }]
      }]
    })

    expect(parseEtfFlowHistoryResponse(body)).toEqual({
      state: 'available',
      rows: [{ date: 1_700_000_000_000, changeUsd: 2, updateTime: '1700000000001' }]
    })
  })

  it('accepts the minimal provider row without list and with an opaque string update marker', () => {
    const body = JSON.stringify({
      code: 200,
      msg: 'redacted',
      data: [{ date: 1_700_000_000_000, change: 1, changeUsd: 2, updateTime: 'opaque-revision' }]
    })

    expect(parseEtfFlowHistoryResponse(body)).toEqual({
      state: 'available',
      rows: [{ date: 1_700_000_000_000, changeUsd: 2, updateTime: 'opaque-revision' }]
    })
  })

  it.each([
    ['wrong code', JSON.stringify({ code: 201, msg: 'x', data: [] })],
    ['missing data', JSON.stringify({ code: 200, msg: 'x' })],
    ['empty data', JSON.stringify({ code: 200, msg: 'x', data: [] })],
    ['non-object row', JSON.stringify({ code: 200, msg: 'x', data: [null] })],
    ['invalid date', JSON.stringify({ code: 200, msg: 'x', data: [{ date: 'unverified', changeUsd: 1 }] })],
    ['invalid change USD', JSON.stringify({ code: 200, msg: 'x', data: [{ date: 1, changeUsd: null }] })],
    ['invalid opaque update marker', JSON.stringify({ code: 200, msg: 'x', data: [{ date: 1, changeUsd: 1, updateTime: {} }] })]
  ])('fails closed for %s', (_label, body) => {
    expect(hasObservedEtfFlowHistoryShape(body)).toBe(false)
    expect(parseEtfFlowHistoryResponse(body)).toEqual({ state: 'unavailable' })
  })

  it('ignores unpersisted provider fields while retaining only current-state inputs', () => {
    const body = JSON.stringify({
      code: 200,
      msg: 'redacted',
    data: [{ date: 1_700_000_000_000, change: 1, changeUsd: 2, list: [{ name: 'example', ticker: 'EXAMPLE', change: 1 }], providerExtra: true }]
    })

    expect(parseEtfFlowHistoryResponse(body)).toEqual({
      state: 'available',
      rows: [{ date: 1_700_000_000_000, changeUsd: 2 }]
    })
  })
})
