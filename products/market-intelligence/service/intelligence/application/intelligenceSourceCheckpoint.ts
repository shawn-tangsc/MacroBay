import type { AppendRawRecordInput } from '../schema/intelligenceRecord'

export type SourceCollectionCheckpoint = {
  appended: number
  parserVersion: string
  lastPublishedAt?: string
  cursor?: string
}

export function buildSourceCollectionCheckpoint(input: {
  rawInputs: AppendRawRecordInput[]
  parserVersion: string
  appended: number
}): SourceCollectionCheckpoint {
  let lastPublishedAt: string | undefined
  let cursor: string | undefined

  for (const record of input.rawInputs) {
    if (record.publishedAt) {
      if (!lastPublishedAt || record.publishedAt.localeCompare(lastPublishedAt) > 0) {
        lastPublishedAt = record.publishedAt
      }
    }
    if (record.externalId) {
      cursor = record.externalId
    }
  }

  return {
    appended: input.appended,
    parserVersion: input.parserVersion,
    lastPublishedAt,
    cursor
  }
}

export function formatSourceCheckpointPreview(checkpoint: SourceCollectionCheckpoint): string {
  const parts = [`appended=${checkpoint.appended}`, `parser=${checkpoint.parserVersion}`]
  if (checkpoint.lastPublishedAt) parts.push(`lastPublishedAt=${checkpoint.lastPublishedAt}`)
  if (checkpoint.cursor) parts.push(`cursor=${checkpoint.cursor}`)
  return parts.join('; ')
}
