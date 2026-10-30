import { createHash } from 'node:crypto'
import { fedFomcOfficialValueProjectionPolicy } from '../../../../contracts/macro/economicCalendarQueryContracts'

import type { MacroCalendarEvidenceRef, MacroCalendarRevision, MacroCalendarValue } from '../macroCalendarContracts'
import type { MacroCalendarRepository } from '../macroCalendarRepository'
import { getMacroCalendarOfficialSourceDescriptor } from '../macroCalendarOfficialSourceRegistry'
import { parseFedFomcStatements } from './fedFomcStatementParser'
import { parseFedFomcDecisionDocument, type FedFomcDecisionDocument } from './fedFomcDecisionParser'
import { parseFedFomcStatementHistory } from './fedFomcStatementHistoryParser'
import type { FedFomcDecisionEvidence } from './fedFomcDecisionEvidence'
import type { PolicyPathFactStore } from '../../policy-path/policyPathFactStore'

export const fedFomcDecisionRefreshPolicy = Object.freeze({
  statementDescriptorId: 'macro-calendar-fed-statement',
  historyDescriptorId: 'macro-calendar-fed-statement-history',
  statementBodyDescriptorId: 'macro-calendar-fed-statement-body',
  providerId: 'macro-calendar-fed',
  eventKeyPrefix: 'US.FOMC.',
  eventKeyPattern: /^US\.FOMC\.\d{4}-\d{2}-\d{2}$/,
  parserVersion: 'fed-fomc-decision-value-v1',
  unit: 'percent',
  sourceKind: 'official-federal-reserve-statement',
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  revisionIdentity: 'sha256([eventKey,predecessor,revisionKind,actual,previous,evidenceHash])'
} as const)

type HttpResponse =
  | { ok: true; descriptorId: string; status: number; acceptedBytes: number; body: string; contentType: string }
  | { ok: false; descriptorId: string; failureCode: string }

export type FedFomcDecisionRefreshService = Readonly<{
  refresh: (input: unknown, signal?: AbortSignal) => Promise<Readonly<{ state: 'updated' | 'unchanged' | 'unavailable' }>>
}>

export function createFedFomcDecisionRefreshService(deps: Readonly<{
  http: Readonly<{
    request: (descriptorId: typeof fedFomcDecisionRefreshPolicy.statementDescriptorId | typeof fedFomcDecisionRefreshPolicy.historyDescriptorId, signal?: AbortSignal) => Promise<HttpResponse>
    requestFomcStatement: (officialStatementUrl: string, signal?: AbortSignal) => Promise<HttpResponse>
  }>
  evidence: FedFomcDecisionEvidence
  repository: Pick<MacroCalendarRepository, 'getEffectiveEventAsOf' | 'appendIfNew'>
  /** Official policy facts; optional so the refresh keeps working in isolation. */
  facts?: Pick<PolicyPathFactStore, 'recordDecision'>
}>): FedFomcDecisionRefreshService {
  let inFlight = false
  return Object.freeze({
    async refresh(input, signal) {
      if (inFlight || signal?.aborted || !isInput(input)) return unavailable()
      inFlight = true
      let currentWrite: ReturnType<typeof deps.repository.appendIfNew> | undefined
      try {
        const current = await currentDecision(input, signal, deps)
        if (!current || signal?.aborted) return unavailable()
        const currentEvidence = deps.evidence.appendVerifiedBody({
          kind: 'current', officialStatementUrl: current.statementUrl, body: current.body, detectedAt: input.detectedAt, runId: input.runId
        })
        if (!currentEvidence || signal?.aborted) return unavailable()
        currentWrite = deps.repository.appendIfNew(revisionForCurrent(current, currentEvidence, input.detectedAt))
        deps.facts?.recordDecision({
          meetingDate: current.document.decisionDate,
          targetRange: { lowerPercent: current.document.targetRange.lowerPercent, upperPercent: current.document.targetRange.upperPercent },
          ...(current.document.vote ? { vote: current.document.vote } : {}),
          ...(current.document.dissents ? { dissents: current.document.dissents } : {}),
          statementUrl: current.statementUrl,
          detectedAt: input.detectedAt
        })
        const prior = await adjacentPrior(current, input, signal, deps)
        if (!prior) return currentWrite.inserted ? updated() : unchanged()
        if (signal?.aborted) return unavailable()
        const priorEvidence = deps.evidence.appendVerifiedBody({
          kind: 'prior', officialStatementUrl: prior.statementUrl, body: prior.body, detectedAt: input.detectedAt, runId: input.runId
        })
        if (!priorEvidence) return currentWrite.inserted ? updated() : unchanged()
        if (signal?.aborted) return unavailable()
        const priorWrite = deps.repository.appendIfNew(revisionForPrior(currentWrite.revision, current, prior, currentEvidence, priorEvidence, input.detectedAt))
        return currentWrite.inserted || priorWrite.inserted ? updated() : unchanged()
      } catch {
        // Optional prior acquisition cannot report that a committed current value was not saved.
        return currentWrite ? currentWrite.inserted ? updated() : unchanged() : unavailable()
      } finally {
        inFlight = false
      }
    }
  })
}

type CurrentDecision = Readonly<{
  statementUrl: string
  body: string
  document: FedFomcDecisionDocument
  schedule: MacroCalendarRevision
}>

type PriorDecision = Readonly<{
  statementUrl: string
  body: string
  document: FedFomcDecisionDocument
  schedule: MacroCalendarRevision
}>

async function currentDecision(
  input: { detectedAt: string; runId: string; expectedEventKey?: string },
  signal: AbortSignal | undefined,
  deps: Parameters<typeof createFedFomcDecisionRefreshService>[0]
): Promise<CurrentDecision | undefined> {
  const descriptor = getMacroCalendarOfficialSourceDescriptor(fedFomcDecisionRefreshPolicy.statementDescriptorId)
  const response = await deps.http.request(fedFomcDecisionRefreshPolicy.statementDescriptorId, signal)
  if (!descriptor || !isSuccessfulResponse(response, descriptor.descriptorId)) return undefined
  const statements = parseFedFomcStatements({ descriptor, body: response.body })
  // The feed keeps the previous meeting's release inside its window, so more than one statement is
  // normal. "Current" is the newest, and a tie on the release time is the only real ambiguity.
  const newestReleasedAt = statements.map((entry) => entry.releasedAt).sort().at(-1)
  const newest = statements.filter((entry) => entry.releasedAt === newestReleasedAt)
  if (newest.length !== 1) return undefined
  const statement = newest[0]!
  const bodyResponse = await deps.http.requestFomcStatement(statement.officialStatementUrl, signal)
  if (!isSuccessfulResponse(bodyResponse, fedFomcDecisionRefreshPolicy.statementBodyDescriptorId)) return undefined
  const document = parseFedFomcDecisionDocument({ body: Buffer.from(bodyResponse.body, 'utf8'), officialStatementUrl: statement.officialStatementUrl })
  if (!document || document.releasedAt !== statement.releasedAt) return undefined
  const schedule = scheduleFor(document.decisionDate, input.detectedAt, deps.repository)
  if (input.expectedEventKey !== undefined && input.expectedEventKey !== schedule?.eventKey) return undefined
  return schedule ? { statementUrl: statement.officialStatementUrl, body: bodyResponse.body, document, schedule } : undefined
}

async function adjacentPrior(
  current: CurrentDecision,
  input: { detectedAt: string; runId: string; expectedEventKey?: string },
  signal: AbortSignal | undefined,
  deps: Parameters<typeof createFedFomcDecisionRefreshService>[0]
): Promise<PriorDecision | undefined> {
  const descriptor = getMacroCalendarOfficialSourceDescriptor(fedFomcDecisionRefreshPolicy.historyDescriptorId)
  const response = await deps.http.request(fedFomcDecisionRefreshPolicy.historyDescriptorId, signal)
  if (!descriptor || !isSuccessfulResponse(response, descriptor.descriptorId)) return undefined
  const entries = parseFedFomcStatementHistory({ descriptor, body: response.body })
  const currentIndex = entries.findIndex((entry) => entry.decisionDate === current.document.decisionDate && entry.officialStatementUrl === current.statementUrl)
  if (currentIndex <= 0) return undefined
  const priorEntry = entries[currentIndex - 1]!
  if (priorEntry.decisionDate >= current.document.decisionDate) return undefined
  const bodyResponse = await deps.http.requestFomcStatement(priorEntry.officialStatementUrl, signal)
  if (!isSuccessfulResponse(bodyResponse, fedFomcDecisionRefreshPolicy.statementBodyDescriptorId)) return undefined
  const document = parseFedFomcDecisionDocument({ body: Buffer.from(bodyResponse.body, 'utf8'), officialStatementUrl: priorEntry.officialStatementUrl })
  if (!document || document.decisionDate !== priorEntry.decisionDate || document.decisionDate >= current.document.decisionDate || document.releasedAt >= current.document.releasedAt) return undefined
  const schedule = scheduleFor(document.decisionDate, input.detectedAt, deps.repository)
  return schedule ? { statementUrl: priorEntry.officialStatementUrl, body: bodyResponse.body, document, schedule } : undefined
}

function scheduleFor(
  decisionDate: string,
  asOf: string,
  repository: Pick<MacroCalendarRepository, 'getEffectiveEventAsOf'>
): MacroCalendarRevision | undefined {
  const eventKey = `${fedFomcDecisionRefreshPolicy.eventKeyPrefix}${decisionDate}`
  const schedule = repository.getEffectiveEventAsOf({ eventKey, asOf })
  return schedule && schedule.providerId === fedFomcDecisionRefreshPolicy.providerId && schedule.eventFamily === 'fomc' &&
    schedule.eventKey === eventKey && schedule.releaseGroupKey === eventKey && schedule.scheduledDate === decisionDate &&
    schedule.scheduledAt === undefined && schedule.lifecycleState !== 'cancelled'
    ? schedule
    : undefined
}

function revisionForCurrent(
  current: CurrentDecision,
  evidence: { rawRecordId: string; evidenceHash: string },
  detectedAt: string
): MacroCalendarRevision {
  const actual = rangeValue(current.document)
  if (current.schedule.actual && sameValue(current.schedule.actual, actual) &&
    current.schedule.publishedAt === current.document.releasedAt && current.schedule.evidenceRefs
      .filter(ref => ref.fieldKinds.includes('actual')).at(-1)?.evidenceHash === evidence.evidenceHash) return current.schedule
  const revisionKind = current.schedule.actual === undefined
    ? 'official-release'
    : sameValue(current.schedule.actual, actual)
      ? priorRevisionKind(current.schedule)
      : 'official-revision'
  const evidenceRef = evidenceReference(current.statementUrl, evidence, detectedAt, ['actual'])
  return revision({
    current: current.schedule,
    revisionKind,
    actual,
    previous: current.schedule.previous,
    publishedAt: current.document.releasedAt,
    sourceUrl: current.statementUrl,
    evidenceHash: evidence.evidenceHash,
    rawRecordId: evidence.rawRecordId,
    evidenceRefs: [...current.schedule.evidenceRefs, evidenceRef],
    detectedAt
  })
}

/** The existing official state owns its revision kind; a replay cannot manufacture a revision by changing only its kind. */
function priorRevisionKind(current: MacroCalendarRevision): 'official-release' | 'official-revision' {
  return current.revisionKind === 'official-revision' ? 'official-revision' : 'official-release'
}

/** A replay of the same independently verified current range remains the original official release. */
function sameValue(left: MacroCalendarValue, right: MacroCalendarValue): boolean {
  return left.displayValue === right.displayValue && left.numericValue === right.numericValue &&
    left.numericLowerBound === right.numericLowerBound && left.numericUpperBound === right.numericUpperBound && left.unit === right.unit
}

function revisionForPrior(
  current: MacroCalendarRevision,
  currentDecision: CurrentDecision,
  prior: PriorDecision,
  currentEvidence: { rawRecordId: string; evidenceHash: string },
  priorEvidence: { rawRecordId: string; evidenceHash: string },
  detectedAt: string
): MacroCalendarRevision {
  const actual = rangeValue(currentDecision.document)
  const previous = rangeValue(prior.document)
  const evidenceHash = hash(`${currentEvidence.evidenceHash}\n${priorEvidence.evidenceHash}`)
  if (current.previous && sameValue(current.previous, previous) && current.evidenceHash === evidenceHash) return current
  return revision({
    current,
    revisionKind: 'official-revision',
    actual,
    previous,
    publishedAt: currentDecision.document.releasedAt,
    sourceUrl: currentDecision.statementUrl,
    evidenceHash,
    rawRecordId: currentEvidence.rawRecordId,
    evidenceRefs: [
      evidenceReference(currentDecision.statementUrl, currentEvidence, detectedAt, ['actual']),
      evidenceReference(prior.statementUrl, priorEvidence, detectedAt, ['previous'])
    ],
    detectedAt
  })
}

function revision(input: Readonly<{
  current: MacroCalendarRevision
  revisionKind: 'official-release' | 'official-revision'
  actual: MacroCalendarValue
  previous: MacroCalendarValue | undefined
  publishedAt: string
  sourceUrl: string
  evidenceHash: string
  rawRecordId: string
  evidenceRefs: MacroCalendarEvidenceRef[]
  detectedAt: string
}>): MacroCalendarRevision {
  const semantic = {
    ...input.current,
    lifecycleState: 'released' as const,
    revisionKind: input.revisionKind,
    publishedAt: input.publishedAt,
    detectedAt: input.detectedAt,
    recordedAt: input.detectedAt,
    actual: input.actual,
    previous: input.previous,
    providerId: fedFomcDecisionRefreshPolicy.providerId,
    descriptorId: fedFomcDecisionRefreshPolicy.statementDescriptorId,
    sourceUrl: input.sourceUrl,
    rawRecordId: input.rawRecordId,
    evidenceHash: input.evidenceHash,
    evidenceRefs: input.evidenceRefs,
    parserVersion: fedFomcDecisionRefreshPolicy.parserVersion,
    caveats: [...new Set([...input.current.caveats,
      ...((input.current.actual && !sameValue(input.current.actual, input.actual)) ||
        (input.current.previous && input.previous && !sameValue(input.current.previous, input.previous))
        ? [fedFomcOfficialValueProjectionPolicy.revisedCaveat] : [])])],
    replacesRevisionId: input.current.revisionId
  }
  return {
    ...semantic,
    revisionId: hash(JSON.stringify([semantic.eventKey, semantic.replacesRevisionId, semantic.revisionKind, semantic.actual, semantic.previous, semantic.evidenceHash])),
    snapshotHash: 'calculated-by-repository'
  }
}

function evidenceReference(
  sourceUrl: string,
  evidence: { rawRecordId: string; evidenceHash: string },
  detectedAt: string,
  fieldKinds: Array<'actual' | 'previous'>
): MacroCalendarEvidenceRef {
  return {
    providerId: fedFomcDecisionRefreshPolicy.providerId,
    descriptorId: fedFomcDecisionRefreshPolicy.statementDescriptorId,
    sourceUrl,
    rawRecordId: evidence.rawRecordId,
    evidenceHash: evidence.evidenceHash,
    detectedAt,
    fieldKinds
  }
}

function rangeValue(document: FedFomcDecisionDocument): MacroCalendarValue {
  return {
    displayValue: `${document.targetRange.lowerPercent.toFixed(2)}%–${document.targetRange.upperPercent.toFixed(2)}%`,
    numericLowerBound: document.targetRange.lowerPercent,
    numericUpperBound: document.targetRange.upperPercent,
    unit: fedFomcDecisionRefreshPolicy.unit
  }
}

function isInput(value: unknown): value is { detectedAt: string; runId: string; expectedEventKey?: string } {
  return isExactRecord(value, ['detectedAt', 'runId']) || (isExactRecord(value, ['detectedAt', 'runId', 'expectedEventKey']) &&
    typeof value.expectedEventKey === 'string' && fedFomcDecisionRefreshPolicy.eventKeyPattern.test(value.expectedEventKey))
    ? isCanonicalUtcMillis(value.detectedAt) && typeof value.runId === 'string' && value.runId.trim().length > 0
    : false
}

function isSuccessfulResponse(value: HttpResponse, descriptorId: string): value is Extract<HttpResponse, { ok: true }> {
  return value.ok && value.descriptorId === descriptorId && Number.isInteger(value.status) && value.status >= 200 && value.status <= 299 &&
    Number.isSafeInteger(value.acceptedBytes) && value.acceptedBytes === Buffer.byteLength(value.body, 'utf8') &&
    typeof value.contentType === 'string' && value.contentType.trim().length > 0
}

function isCanonicalUtcMillis(value: unknown): value is string {
  return typeof value === 'string' && fedFomcDecisionRefreshPolicy.canonicalUtcMillisPattern.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}

function isExactRecord(value: unknown, fields: readonly string[]): value is Record<string, any> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false
    const names = Object.getOwnPropertyNames(value)
    return names.length === fields.length && fields.every((field) => Object.hasOwn(value, field)) && Object.getOwnPropertySymbols(value).length === 0 &&
      names.every((field) => Boolean(Object.getOwnPropertyDescriptor(value, field)?.value !== undefined || Object.getOwnPropertyDescriptor(value, field)))
  } catch {
    return false
  }
}

function hash(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex') }
function updated() { return Object.freeze({ state: 'updated' as const }) }
function unchanged() { return Object.freeze({ state: 'unchanged' as const }) }
function unavailable() { return Object.freeze({ state: 'unavailable' as const }) }
