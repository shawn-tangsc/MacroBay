import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

const expectedDescriptors = Object.freeze([
  Object.freeze({ descriptorId: 'macro-calendar-0xrouter-economic-data', endpointPath: '/cexdata/calendar/economic-data' }),
  Object.freeze({ descriptorId: 'macro-calendar-0xrouter-financial-events', endpointPath: '/cexdata/calendar/financial-events' }),
  Object.freeze({ descriptorId: 'macro-calendar-0xrouter-central-bank-activities', endpointPath: '/cexdata/calendar/central-bank-activities' })
])

const expectedFixtureFiles = Object.freeze([
  'zeroxrouter-economic-data-zh-success.json',
  'zeroxrouter-economic-data-en-success.json',
  // The captured September 2026 CPI release: byte-identical provider body, no key, no URL.
  'zeroxrouter-economic-data-zh-2026-10-success.json',
  'zeroxrouter-economic-data-empty.json',
  'zeroxrouter-financial-events-zh-success.json',
  'zeroxrouter-financial-events-en-success.json',
  'zeroxrouter-central-bank-activities-zh-success.json',
  'zeroxrouter-central-bank-activities-en-success.json',
  'zeroxrouter-error-envelope.json',
  'zeroxrouter-missing-fields.json'
])

const expectedCandidateIds = Object.freeze([
  'us-cpi-yoy',
  'us-core-cpi-yoy',
  'us-nonfarm-payrolls',
  'us-unemployment-rate',
  'us-average-hourly-earnings-mom',
  'us-pce-yoy',
  'us-core-pce-yoy',
  'us-real-gdp-qoq-annualized',
  'us-fomc-target-rate-decision'
])

const manifestFile = 'zeroxrouter-fixture-manifest.json'
const unsafeFixtureText = /(?:x-my-token|authorization|api[_-]?key|bearer|cookie|https?:\/\/|file:\/\/|\/users\/|[?&][a-z][a-z0-9_-]*=)/i

type JsonRecord = Record<string, unknown>

function filePath(file: string): string {
  return join(fixtureDirectory, file)
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(filePath(file), 'utf8')) as unknown
}

function object(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined
}

function manifestOrUndefined(): JsonRecord | undefined {
  if (!existsSync(filePath(manifestFile))) return undefined
  return object(readJson(manifestFile))
}

function fixtureCaseByFile(manifest: JsonRecord, file: string): JsonRecord | undefined {
  const cases = Array.isArray(manifest.fixtureCases) ? manifest.fixtureCases : []
  return cases.map(object).find((item) => item?.fixtureFile === file)
}

function assertSecretFree(value: unknown): void {
  if (typeof value === 'string') {
    expect(value).not.toMatch(unsafeFixtureText)
    return
  }
  if (Array.isArray(value)) {
    value.forEach(assertSecretFree)
    return
  }
  const record = object(value)
  if (record) Object.values(record).forEach(assertSecretFree)
}

describe('0xRouter calendar fixture evidence contract', () => {
  it('requires the MC0 manifest and all bounded, secret-free fixture files', () => {
    expect(existsSync(filePath(manifestFile))).toBe(true)
    expectedFixtureFiles.forEach((file) => expect(existsSync(filePath(file))).toBe(true))

    const manifest = manifestOrUndefined()
    if (!manifest) return
    assertSecretFree(manifest)
    expectedFixtureFiles.forEach((file) => assertSecretFree(readJson(file)))
  })

  it('records the three fixed endpoint descriptors and observed success-envelope field contracts', () => {
    const manifest = manifestOrUndefined()
    if (!manifest) return

    expect(manifest).toMatchObject({
      schemaVersion: '0xrouter-calendar-fixture-manifest-v1',
      providerId: '0xrouter',
      evidenceAdmission: 'controlled-main-process-archive'
    })
    const descriptors = Array.isArray(manifest.descriptors) ? manifest.descriptors.map(object) : []
    expect(descriptors.map((item) => ({ descriptorId: item?.descriptorId, endpointPath: item?.endpointPath }))).toEqual(expectedDescriptors)

    descriptors.forEach((descriptor) => {
      expect(descriptor?.localeEvidence).toBeDefined()
      const localeEvidence = object(descriptor?.localeEvidence)
      ;(['zh', 'en'] as const).forEach((locale) => {
        const evidence = object(localeEvidence?.[locale])
        expect(evidence).toMatchObject({ locale, origin: 'captured-controlled-archive' })
        expect(evidence?.evidenceHash).toMatch(/^[a-f0-9]{64}$/)
        expect(evidence?.acceptedBytes).toEqual(expect.any(Number))
        expect((evidence?.acceptedBytes as number) > 0).toBe(true)
      })
      expect(descriptor?.observedEnvelopeFields).toEqual({ code: 'number', msg: 'string', data: 'array' })
      expect(descriptor?.observedDataFieldTypes).toEqual(expect.any(Object))
      expect(descriptor?.localeMerge).toMatchObject({ state: 'disabled', officialLinkConsensus: 'disabled' })
    })

    expectedFixtureFiles.filter((file) => file.endsWith('-success.json')).forEach((file) => {
      const fixture = object(readJson(file))
      expect(fixture).toMatchObject({ code: 200, msg: expect.any(String), data: expect.any(Array) })
      expect(fixtureCaseByFile(manifest, file)).toMatchObject({ origin: 'captured-controlled-archive' })
    })
  })

  it('marks synthetic empty, error, and missing-field cases as derived and keeps all unproven candidate mappings planned', () => {
    const manifest = manifestOrUndefined()
    if (!manifest) return

    ;['zeroxrouter-economic-data-empty.json', 'zeroxrouter-error-envelope.json', 'zeroxrouter-missing-fields.json'].forEach((file) => {
      expect(fixtureCaseByFile(manifest, file)).toMatchObject({ origin: 'derived-contract-case' })
    })
    expect(object(readJson('zeroxrouter-economic-data-empty.json'))).toMatchObject({ code: 200, data: [] })
    expect(object(readJson('zeroxrouter-error-envelope.json'))).toMatchObject({ msg: 'redacted-provider-error' })
    expect(object(readJson('zeroxrouter-missing-fields.json'))).toMatchObject({ code: 200, data: [{}] })

    const candidates = Array.isArray(manifest.candidateMappings) ? manifest.candidateMappings.map(object) : []
    expect(candidates.map((item) => item?.candidateId)).toEqual(expectedCandidateIds)
    candidates.forEach((candidate) => {
      expect(candidate?.status).toBe('planned')
      expect(candidate?.admissionEvidence).toBe('insufficient')
      expect(candidate).not.toHaveProperty('indicatorId')
    })
  })
})
