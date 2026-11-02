/**
 * The brief's IPC guards: what a stored or incoming document may look like before anything renders it.
 *
 * A malformed document is rejected here rather than rendered as data; an oversized one is refused
 * before it is stored. The budget numbers come from the policy module, never from a second copy.
 */

import { dailyBriefingPolicy } from './policies'
import { briefingGenerationStageIds, type BriefingGenerationTrace } from './conclusion'
import type { DailyBriefingLocale, DailyBriefingReadingState, FactImportanceTier } from './readings'

export function isDailyBriefingLocale(value: unknown): value is DailyBriefingLocale {
  return value === 'zh-CN' || value === 'en-US'
}

export function isDailyBriefingEditionDate(value: unknown): value is string {
  if (typeof value !== 'string' || !dailyBriefingPolicy.editionDatePattern.test(value)) return false
  const parsed = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
}

export function isDailyBriefingReadingState(value: unknown): value is DailyBriefingReadingState {
  return value === 'available' || value === 'stale' || value === 'unavailable' || value === 'source-disabled'
}

export function isFactImportanceTier(value: unknown): value is FactImportanceTier {
  return value === 'must' || value === 'support' || value === 'reference'
}

const generationStageIds: ReadonlySet<string> = new Set(briefingGenerationStageIds)
const generationStageStates: ReadonlySet<string> = new Set(['success', 'failed', 'skipped', 'pending'])

/** The IPC guard for the optional trace: a malformed trace is dropped, never rendered as data. */
export function isBriefingGenerationTrace(value: unknown): value is BriefingGenerationTrace {
  if (!isRecord(value)) return false
  if (!isBoundedText(value.attemptId, 200)) return false
  if (!isInstant(value.startedAt) || !isInstant(value.finishedAt)) return false
  if (value.state !== 'success' && value.state !== 'failed') return false
  if (!Array.isArray(value.stages) || value.stages.length === 0 || value.stages.length > briefingGenerationStageIds.length) return false
  const seen = new Set<string>()
  for (const stage of value.stages) {
    if (!isRecord(stage)) return false
    if (typeof stage.id !== 'string' || !generationStageIds.has(stage.id) || seen.has(stage.id)) return false
    seen.add(stage.id)
    if (typeof stage.state !== 'string' || !generationStageStates.has(stage.state)) return false
    if (stage.startedAt !== undefined && !isInstant(stage.startedAt)) return false
    if (stage.finishedAt !== undefined && !isInstant(stage.finishedAt)) return false
    if (stage.durationMs !== undefined && !(typeof stage.durationMs === 'number' && Number.isFinite(stage.durationMs) && stage.durationMs >= 0)) return false
    if (stage.failureCode !== undefined && !isBoundedText(stage.failureCode, 200)) return false
    if (stage.failureDetail !== undefined && !isBoundedText(stage.failureDetail, 2_000)) return false
  }
  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBoundedText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= limit
}

function isInstant(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value))
}

/** The document crosses IPC; reject an oversized payload before it is stored or rendered. */
export function isDailyBriefingDocumentWithinBudget(value: unknown): boolean {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= dailyBriefingPolicy.maximumBytes
  } catch {
    return false
  }
}

