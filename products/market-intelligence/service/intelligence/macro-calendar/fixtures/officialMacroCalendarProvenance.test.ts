import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { officialMacroCalendarFixtureProvenance } from './officialMacroCalendarProvenance'

describe('official macro calendar fixture provenance', () => {
  it('records all six fixed descriptors without saving unavailable response bodies as fixtures', () => {
    expect(officialMacroCalendarFixtureProvenance.map((item) => item.descriptorId)).toEqual([
      'macro-calendar-fed-schedule', 'macro-calendar-fed-statement', 'macro-calendar-bls-schedule',
      'macro-calendar-bls-values', 'macro-calendar-bea-schedule', 'macro-calendar-bea-values'
    ])
    expect(officialMacroCalendarFixtureProvenance.filter((item) => item.status !== 200).every((item) => !item.fixtureFile)).toBe(true)
  })

  it('ties every public raw fixture to its captured byte length and sha256', () => {
    const fixtureDirectory = dirname(fileURLToPath(import.meta.url))
    for (const fixture of officialMacroCalendarFixtureProvenance.filter((item) => item.fixtureFile)) {
      const body = readFileSync(join(fixtureDirectory, fixture.fixtureFile!))
      expect(existsSync(join(fixtureDirectory, fixture.fixtureFile!))).toBe(true)
      expect(body.byteLength).toBe(fixture.payloadBytes)
      expect(createHash('sha256').update(body).digest('hex')).toBe(fixture.sha256)
    }
  })
})
