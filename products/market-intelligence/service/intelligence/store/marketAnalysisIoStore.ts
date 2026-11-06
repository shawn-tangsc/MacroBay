import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

import { analysisIoRetentionPolicy } from '../retention/analysisIoRetention'
import { decodeAnalysisIoValue, encodeAnalysisIoValue, type AnalysisIoStoredValue } from './marketAnalysisIoCodec'

export type { AnalysisIoStoredValue } from './marketAnalysisIoCodec'

/**
 * One row per model call — not per analysis run.
 *
 * A run may call the model twice (the one in-place repair) and a retried transport adds a third
 * call. Keeping only the last answer would delete exactly the material a post-mortem needs: why the
 * first call was thrown away. The row is written *before* the call, so a process killed inside the
 * 240 s timeout still leaves the rendered prompt behind; the answer column is filled afterwards.
 *
 * The prompt and the answer are gzipped so the "30 days / 100 MB" promise is measured against the
 * bytes actually on disk. Storing them uncompressed would shorten the real window while the copy
 * still said thirty days.
 */

export const analysisIoCallKinds = ['initial', 'repair', 'transport-retry'] as const
export type AnalysisIoCallKind = (typeof analysisIoCallKinds)[number]

export const analysisIoOutputStatuses = ['inflight', 'answered', 'invalid-json', 'transport-error', 'cancelled'] as const
export type AnalysisIoOutputStatus = (typeof analysisIoOutputStatuses)[number]

export type AnalysisIoRow = Readonly<{
  id: string
  schemaVersion: number
  analysisRunId: string
  callIndex: number
  callKind: AnalysisIoCallKind
  modelProviderId: string | null
  modelId: string | null
  promptVersion: string | null
  timeoutMs: number | null
  prompt: AnalysisIoStoredValue
  promptBytes: number | null
  promptSha256: string | null
  output: AnalysisIoStoredValue
  outputBytes: number | null
  outputSha256: string | null
  outputStatus: AnalysisIoOutputStatus
  failureDetailCode: string | null
  withheldReason: string | null
  createdAt: string
  updatedAt: string
}>

export type AnalysisIoBeginInput = Readonly<{
  analysisRunId: string
  /** 1 for the first call of the run, 2 for the repair, 3 for a transport retry. */
  callIndex: number
  callKind: AnalysisIoCallKind
  /** The rendered prompt as a JSON value (the message array). Serialized here, then gzipped. */
  prompt: unknown
  modelProviderId?: string | null
  modelId?: string | null
  promptVersion?: string | null
  timeoutMs?: number | null
  /**
   * `credential-shape` when the prompt carried something shaped like a key: the call is recorded but
   * the body column stays empty. The hash and byte count are still written, so the row proves a
   * prompt existed without storing it.
   */
  withheldReason?: string | null
  atMs?: number
}>

export type AnalysisIoCompletionInput = Readonly<{
  id: string
  outputStatus: AnalysisIoOutputStatus
  /** The model's answer. Absent when the call never returned (timeout, transport error, cancel). */
  output?: unknown
  failureDetailCode?: string | null
  atMs?: number
}>

export type AnalysisIoUsage = Readonly<{ rows: number; bytes: number }>

export type AnalysisIoRetentionResult = Readonly<{
  deleted: number
  bytesBefore: number
  bytesAfter: number
  oldestKeptAtMs: number | null
}>

export type AnalysisIoStore = Readonly<{
  begin: (input: AnalysisIoBeginInput) => Readonly<{ id: string; createdAt: string }>
  complete: (input: AnalysisIoCompletionInput) => boolean
  readByRunId: (analysisRunId: string) => readonly AnalysisIoRow[]
  usage: () => AnalysisIoUsage
  retention: (input: Readonly<{ cutoffIso: string; byteBudgetBytes?: number }>) => AnalysisIoRetentionResult
}>

/** Additive: a new install gets the table from here, an existing database gets it if it is missing. */
export function migrateAnalysisIo(database: DatabaseSync): void {
  database.exec(`
    create table if not exists mi_analysis_io (
      id text primary key,
      schema_version integer not null,
      analysis_run_id text not null,
      call_index integer not null,
      call_kind text not null,
      model_provider_id text,
      model_id text,
      prompt_version text,
      timeout_ms integer,
      prompt_gzip blob,
      prompt_bytes integer,
      prompt_sha256 text,
      output_gzip blob,
      output_bytes integer,
      output_sha256 text,
      output_status text not null,
      failure_detail_code text,
      withheld_reason text,
      created_at text not null,
      updated_at text not null,
      unique(analysis_run_id, call_index)
    );
    create index if not exists idx_mi_analysis_io_created on mi_analysis_io(created_at)
  `)
}

export function createAnalysisIoStore(database: DatabaseSync): AnalysisIoStore {
  return Object.freeze({
    begin(input) {
      assertRunId(input.analysisRunId)
      if (!Number.isSafeInteger(input.callIndex) || input.callIndex < 1) throw new Error('analysis-io-call-index-invalid')
      assertCallKind(input.callKind)
      if (input.prompt === undefined) throw new Error('analysis-io-prompt-incomplete')
      const atMs = input.atMs ?? Date.now()
      const createdAt = new Date(atMs).toISOString()
      const withheldReason = input.withheldReason ?? null
      const encoded = encodeAnalysisIoValue(input.prompt)
      const id = `mi-io-${randomUUID()}`
      // A withheld prompt keeps its size and digest but not its body: the row still says a call was
      // made, and the reader's run is unaffected.
      const gzip = withheldReason ? null : encoded.gzip
      const sha256 = encoded.sha256
      database.prepare(`insert into mi_analysis_io
        (id,schema_version,analysis_run_id,call_index,call_kind,model_provider_id,model_id,prompt_version,timeout_ms,prompt_gzip,prompt_bytes,prompt_sha256,output_gzip,output_bytes,output_sha256,output_status,failure_detail_code,withheld_reason,created_at,updated_at)
        values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, 1, input.analysisRunId, input.callIndex, input.callKind,
        input.modelProviderId ?? null, input.modelId ?? null, input.promptVersion ?? null, input.timeoutMs ?? null,
        gzip, encoded.bytes, sha256,
        null, null, null, 'inflight', null, withheldReason, createdAt, createdAt)
      return Object.freeze({ id, createdAt })
    },
    complete(input) {
      if (typeof input.id !== 'string' || input.id.length === 0) throw new Error('analysis-io-id-invalid')
      assertOutputStatus(input.outputStatus)
      if (input.outputStatus === 'inflight') throw new Error('analysis-io-output-status-invalid')
      const current = database.prepare('select 1 as present from mi_analysis_io where id=?').get(input.id)
      if (!current) return false
      const atMs = input.atMs ?? Date.now()
      const updatedAt = new Date(atMs).toISOString()
      if (input.output === undefined) {
        database.prepare('update mi_analysis_io set output_status=?, failure_detail_code=?, updated_at=? where id=?')
          .run(input.outputStatus, input.failureDetailCode ?? null, updatedAt, input.id)
        return true
      }
      const encoded = encodeAnalysisIoValue(input.output)
      // The answer is never withheld by the prompt's marker: the marker describes the prompt, and the
      // model answered regardless. The answer has its own storage path in the output column.
      database.prepare('update mi_analysis_io set output_gzip=?, output_bytes=?, output_sha256=?, output_status=?, failure_detail_code=?, updated_at=? where id=?')
        .run(encoded.gzip, encoded.bytes, encoded.sha256, input.outputStatus, input.failureDetailCode ?? null, updatedAt, input.id)
      return true
    },
    readByRunId(analysisRunId) {
      const rows = database.prepare('select * from mi_analysis_io where analysis_run_id=? order by call_index asc, id asc').all(analysisRunId) as StoredIoRow[]
      return Object.freeze(rows.map(fromStoredRow))
    },
    usage() {
      return Object.freeze({ rows: countRows(database), bytes: totalBytes(database) })
    },
    retention(input) {
      if (typeof input.cutoffIso !== 'string' || input.cutoffIso.length === 0) throw new Error('analysis-io-cutoff-invalid')
      const budget = input.byteBudgetBytes ?? analysisIoRetentionPolicy.byteBudget
      if (!Number.isSafeInteger(budget) || budget < 0) throw new Error('analysis-io-budget-invalid')
      const batchSize = analysisIoRetentionPolicy.batchSize
      const bytesBefore = totalBytes(database)
      let deleted = 0
      database.exec('begin immediate')
      try {
        // Age first: a pass whose month is over must drop those rows even if the file is small.
        for (;;) {
          const ids = (database.prepare(`select id from mi_analysis_io where created_at < ? order by created_at asc, id asc limit ${batchSize}`)
            .all(input.cutoffIso) as Array<{ id: string }>).map(row => String(row.id))
          if (ids.length === 0) break
          deleteRows(database, ids)
          deleted += ids.length
          if (ids.length < batchSize) break
        }
        // Then the ceiling, oldest first, until the actual bytes are back under it. Running the sum
        // over the rows themselves is what keeps "100 MB" true when prompts change size.
        let bytes = totalBytes(database)
        while (bytes > budget) {
          const oldest = database.prepare(`select id, coalesce(length(prompt_gzip),0)+coalesce(length(output_gzip),0) as bytes from mi_analysis_io order by created_at asc, id asc limit ${batchSize}`).all() as Array<{ id: string; bytes: number }>
          if (oldest.length === 0) break
          // Delete only as much of the batch as the excess needs: dropping the whole batch would
          // overshoot the ceiling by up to a batch and shorten the real window for no reason.
          const excess = bytes - budget
          const ids: string[] = []
          let released = 0
          for (const row of oldest) {
            ids.push(String(row.id))
            released += Number(row.bytes)
            if (released >= excess) break
          }
          deleteRows(database, ids)
          deleted += ids.length
          bytes -= released
        }
        database.exec('commit')
      } catch (error) {
        try { database.exec('rollback') } catch { /* preserve the original failure */ }
        throw error
      }
      const oldest = database.prepare('select min(created_at) as created_at from mi_analysis_io').get() as { created_at: string | null } | undefined
      return Object.freeze({
        deleted,
        bytesBefore,
        bytesAfter: totalBytes(database),
        oldestKeptAtMs: oldest?.created_at == null ? null : Date.parse(String(oldest.created_at))
      })
    }
  })
}

type StoredIoRow = Readonly<{
  id: string
  schema_version: number
  analysis_run_id: string
  call_index: number
  call_kind: string
  model_provider_id: string | null
  model_id: string | null
  prompt_version: string | null
  timeout_ms: number | null
  prompt_gzip: Uint8Array | null
  prompt_bytes: number | null
  prompt_sha256: string | null
  output_gzip: Uint8Array | null
  output_bytes: number | null
  output_sha256: string | null
  output_status: string
  failure_detail_code: string | null
  withheld_reason: string | null
  created_at: string
  updated_at: string
}>

function fromStoredRow(row: StoredIoRow): AnalysisIoRow {
  const withheldReason = row.withheld_reason ?? null
  return Object.freeze({
    id: String(row.id),
    schemaVersion: Number(row.schema_version),
    analysisRunId: String(row.analysis_run_id),
    callIndex: Number(row.call_index),
    callKind: String(row.call_kind) as AnalysisIoCallKind,
    modelProviderId: row.model_provider_id ?? null,
    modelId: row.model_id ?? null,
    promptVersion: row.prompt_version ?? null,
    timeoutMs: row.timeout_ms == null ? null : Number(row.timeout_ms),
    prompt: decodeAnalysisIoValue(row.prompt_gzip, withheldReason ? 'withheld' : 'absent'),
    promptBytes: row.prompt_bytes == null ? null : Number(row.prompt_bytes),
    promptSha256: row.prompt_sha256 ?? null,
    output: decodeAnalysisIoValue(row.output_gzip, 'absent'),
    outputBytes: row.output_bytes == null ? null : Number(row.output_bytes),
    outputSha256: row.output_sha256 ?? null,
    outputStatus: String(row.output_status) as AnalysisIoOutputStatus,
    failureDetailCode: row.failure_detail_code ?? null,
    withheldReason,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  })
}

function deleteRows(database: DatabaseSync, ids: readonly string[]): void {
  const placeholders = ids.map(() => '?').join(',')
  database.prepare(`delete from mi_analysis_io where id in (${placeholders})`).run(...ids)
}

function totalBytes(database: DatabaseSync): number {
  const row = database.prepare(`select coalesce(sum(coalesce(length(prompt_gzip),0)+coalesce(length(output_gzip),0)),0) as bytes from mi_analysis_io`).get() as { bytes: number } | undefined
  return Number(row?.bytes ?? 0)
}

function countRows(database: DatabaseSync): number {
  const row = database.prepare('select count(*) as count from mi_analysis_io').get() as { count: number } | undefined
  return Number(row?.count ?? 0)
}

function assertRunId(value: string): void {
  if (typeof value !== 'string' || value.length === 0) throw new Error('analysis-io-run-id-invalid')
}

function assertCallKind(value: string): void {
  if (!(analysisIoCallKinds as readonly string[]).includes(value)) throw new Error('analysis-io-call-kind-invalid')
}

function assertOutputStatus(value: string): void {
  if (!(analysisIoOutputStatuses as readonly string[]).includes(value)) throw new Error('analysis-io-output-status-invalid')
}
