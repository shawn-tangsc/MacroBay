import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { RuntimeStateRecord } from '@platform/jobs'

export type IntelligenceRuntimeStateHistoryStorage = {
  readAll: () => Promise<RuntimeStateRecord[]>
  writeAll: (records: RuntimeStateRecord[]) => Promise<void>
}

export function readIntelligenceRuntimeStateHistorySync(filePath: string): RuntimeStateRecord[] {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
    return Array.isArray(parsed) ? parsed.filter(isRuntimeStateRecord) : []
  } catch {
    return []
  }
}

export function createIntelligenceRuntimeStateHistoryJsonStorage(
  filePath: string
): IntelligenceRuntimeStateHistoryStorage {
  return {
    async readAll() {
      try {
        const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown
        return Array.isArray(parsed) ? parsed.filter(isRuntimeStateRecord) : []
      } catch (error) {
        if (isMissingFileError(error)) return []
        throw error
      }
    },
    async writeAll(records) {
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, `${JSON.stringify(records, null, 2)}\n`, 'utf8')
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
