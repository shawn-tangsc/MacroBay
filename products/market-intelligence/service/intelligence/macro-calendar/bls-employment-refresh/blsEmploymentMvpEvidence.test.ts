import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createRawRecordStore } from '../../application/rawRecordStore'
import { createBlsEmploymentMvpEvidence } from './blsEmploymentMvpEvidence'
import { createMacroCalendarEvidenceArchive } from '../macroCalendarEvidenceArchive'

const directories: string[] = []
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })))

describe('BLS Employment MVP evidence', () => {
  it('retains only a bounded API body under the fixed source identity and dedupes it', () => {
    const records = createRawRecordStore()
    const evidence = createEvidence(records)
    const first = evidence.appendApiBody('{"status":"REQUEST_SUCCEEDED"}', '2026-08-08T00:00:00.000Z', evidence.reserve(1_500_000)!)
    const second = evidence.appendApiBody('{"status":"REQUEST_SUCCEEDED"}', '2026-08-08T00:00:00.000Z', evidence.reserve(1_500_000)!)
    expect(first).toMatchObject({ rawRecordId: 'raw-1' })
    expect(second).toEqual(first)
    expect(records.getRawRecord(first!.rawRecordId)).toMatchObject({ sourceId: 'macro-calendar-bls-calendar-family-refresh-api-evidence-v2', sourceUrl: 'https://api.bls.gov/publicAPI/v2/timeseries/data/', payloadFormat: 'json' })
  })

  it('rejects invalid time or a body over the fixed cap without writing', () => {
    const records = createRawRecordStore()
    const evidence = createEvidence(records)
    expect(evidence.appendApiBody('x', 'not-time', evidence.reserve(1_500_000)!)).toBeUndefined()
    expect(evidence.appendApiBody('x'.repeat(1_500_001), '2026-08-08T00:00:00.000Z', evidence.reserve(1_500_000)!)).toBeUndefined()
    expect(records.listByProcessingOwner('macro-calendar', 10)).toEqual([])
  })
})

function createEvidence(records: ReturnType<typeof createRawRecordStore>) {
  const directory = mkdtempSync(join(tmpdir(), 'bls-employment-evidence-'))
  directories.push(directory)
  return createBlsEmploymentMvpEvidence({
    archive: createMacroCalendarEvidenceArchive({ rawRecords: records, archiveDirectory: directory })
  })
}
