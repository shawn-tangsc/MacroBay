import { readJsonFileRecovering, readJsonFileRecoveringSync, writeJsonFileAtomically } from '@platform/storage/jsonFileStorage'

import type { RuntimeStateRecord } from '@platform/jobs'

export type IntelligenceRuntimeStateHistoryStorage = {
  readAll: () => Promise<RuntimeStateRecord[]>
  writeAll: (records: RuntimeStateRecord[]) => Promise<void>
}

export function readIntelligenceRuntimeStateHistorySync(filePath: string): RuntimeStateRecord[] {
  const parsed = readJsonFileRecoveringSync(filePath)
  return Array.isArray(parsed) ? parsed.filter(isRuntimeStateRecord) : []
}

export function createIntelligenceRuntimeStateHistoryJsonStorage(
  filePath: string
): IntelligenceRuntimeStateHistoryStorage {
  return {
    async readAll() {
      const parsed = await readJsonFileRecovering(filePath)
      return Array.isArray(parsed) ? parsed.filter(isRuntimeStateRecord) : []
    },
    async writeAll(records) {
      await writeJsonFileAtomically(filePath, records)
    }
  }
}

function isRuntimeStateRecord(value: unknown): value is RuntimeStateRecord {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RuntimeStateRecord>
  return Boolean(candidate.owner && candidate.resourceId && candidate.status && candidate.updatedAt)
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
