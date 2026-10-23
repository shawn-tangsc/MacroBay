import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { blsObservationFixtureProvenance } from './blsObservationProvenance'

describe('BLS observed-value fixture provenance', () => {
  it('ties the fixed six-series public POST capture to its original bytes', () => {
    const fixture = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', blsObservationFixtureProvenance.fixtureFile))
    expect(blsObservationFixtureProvenance).toMatchObject({
      canonicalUrl: 'https://api.bls.gov/publicAPI/v2/timeseries/data/', method: 'POST', status: 200,
      requestTemplate: 'bls-six-public-series-2025-2026', contentType: 'application/json', payloadBytes: fixture.byteLength
    })
    expect(createHash('sha256').update(fixture).digest('hex')).toBe(blsObservationFixtureProvenance.sha256)
  })
})
