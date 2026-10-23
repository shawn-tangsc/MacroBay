import { expect, it } from 'vitest'

import { isProvenanceExplainQuery, parseProvenanceExplanation, provenanceMethods } from './provenanceContracts'

/** 口径查询的 wire 边界（设计 144 §4.2）：只接受一个族名，只送合法形状。 */
const available = {
  state: 'available', family: 'cross-market-reading', nameKey: 'provenance.cross-market-reading.title',
  source: { route: 'cross-asset snapshot (derived, not a provider)', providerIds: ['binance-cross-asset'], seriesIds: ['index/btc/eth bars'] },
  cadence: { kind: 'bar', intervalMs: 300_000 }, instant: { rule: 'bar-end' },
  formula: { id: 'leg-direction-then-scenario-match', expression: '…', functionRefs: ['resolveCrossAssetReading'] },
  values: { 'flat-band.dxy': 0.06, 'reading.window': '24h' },
  substitutions: ['index-proxy'], degradations: ['no-match'], caveatIds: []
}

it('names the method and only accepts a bounded family name', () => {
  expect(provenanceMethods.explainFigure).toBe('intelligence.provenance.explainFigure')
  expect(isProvenanceExplainQuery({ family: 'cross-market-reading' })).toBe(true)
  for (const payload of [{}, { family: '' }, { family: 'Cross Market' }, { family: 'a'.repeat(65) }, { family: 'daily', extra: 1 }, null, 'daily'])
    expect(isProvenanceExplainQuery(payload), JSON.stringify(payload)).toBe(false)
})

it('accepts the two legal shapes and refuses everything else', () => {
  expect(parseProvenanceExplanation(available)).toEqual(available)
  const unavailable = { state: 'unavailable', family: 'moon-phase', reason: 'unknown-family', ownedHere: [] }
  expect(parseProvenanceExplanation(unavailable)).toEqual(unavailable)
  const cases = [
    { ...available, state: 'guessed' },
    { ...available, cadence: { kind: 'bar', intervalMs: Number.NaN } },
    { ...available, instant: { rule: 'whenever' } },
    { ...available, values: { x: Number.POSITIVE_INFINITY } },
    { ...available, functionRefs: 'not-an-array' },
    { state: 'unavailable', family: 'x', reason: 'made-up', ownedHere: [] },
    { state: 'unavailable', family: 'x', reason: 'unknown-family' }
  ]
  for (const value of cases) expect(parseProvenanceExplanation(value)).toBeUndefined()
})
