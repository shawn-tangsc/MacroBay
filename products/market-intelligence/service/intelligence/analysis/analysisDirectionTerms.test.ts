import { expect, it } from 'vitest'

// The renderer policy is imported here on purpose: this is the one place the two vocabularies are
// compared, so the term a model is told to use cannot drift from the term the panel can colour.
// Production code never crosses this boundary in either direction.
import { analysisConclusionDirectionPolicy } from '../../../desktop/pages/intelligence/analysisConclusionDirectionPolicy'
import { marketAnalysisValidationPolicy } from './analysisConstants'

it('tells the model exactly the terms the panel can colour, in the same order', () => {
  expect([...marketAnalysisValidationPolicy.directionTerms])
    .toEqual(Object.values(analysisConclusionDirectionPolicy.markers))
})

it('states one window for every horizon it demands, and no horizon it cannot describe', () => {
  for (const horizon of marketAnalysisValidationPolicy.directionHorizons) {
    expect(marketAnalysisValidationPolicy.directionWindows[horizon], horizon).toBeTruthy()
  }
  expect(Object.keys(marketAnalysisValidationPolicy.directionWindows).sort())
    .toEqual([...marketAnalysisValidationPolicy.directionHorizons].sort())
})

it('keeps the language-neutral keys in step with the panel', () => {
  // The panel owns one label per language keyed by these keys; the model only ever sees the keys.
  expect([...marketAnalysisValidationPolicy.analysisDirectionKeys])
    .toEqual(Object.keys(analysisConclusionDirectionPolicy.markers))
})
