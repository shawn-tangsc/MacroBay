import { createHash } from 'node:crypto'

import type { MacroCalendarRevision } from '../macroCalendarContracts'
import { toUtcIsoFromOfficialEasternTime } from '../macroCalendarTimeZone'
import type { BeaReleaseGroup } from './beaOfficialReleaseRssRecognizer'

export const beaOfficialReleasePollingPolicy = Object.freeze({
  providerId: 'macro-calendar-bea',
  scheduleDescriptorId: 'macro-calendar-bea-schedule',
  initialObservationWindowMs: 2 * 60 * 60 * 1_000,
  delayedObservationWindowMs: 48 * 60 * 60 * 1_000,
  dateOnlyObservationIntervalMs: 6 * 60 * 60 * 1_000,
  dateOnlyStartTime: '00:00',
  maximumGroupsPerRun: 4,
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
})

export type BeaOfficialReleaseCandidate = Readonly<{ group: BeaReleaseGroup; scheduleFingerprint: string }>

export function selectDueBeaOfficialReleaseGroups(input: Readonly<{ revisions: readonly MacroCalendarRevision[]; now: string }>): BeaReleaseGroup[] {
  return selectBeaOfficialReleaseCandidates(input).map((candidate) => candidate.group)
}

export function selectBeaOfficialReleaseCandidates(input: Readonly<{ revisions: readonly MacroCalendarRevision[]; now: string }>): BeaOfficialReleaseCandidate[] {
  const now = timestamp(input.now)
  if (now === undefined || !Array.isArray(input.revisions)) return []
  const groups = new Map<string, MacroCalendarRevision[]>()
  for (const revision of input.revisions) {
    if (!isBeaSchedule(revision)) continue
    const members = groups.get(revision.releaseGroupKey) ?? []
    members.push(revision)
    groups.set(revision.releaseGroupKey, members)
  }
  return [...groups.values()].map((members) => candidate(members, now)).filter((value): value is BeaOfficialReleaseCandidate => value !== undefined)
    .sort((left, right) => left.group.releaseGroupKey.localeCompare(right.group.releaseGroupKey)).slice(0, beaOfficialReleasePollingPolicy.maximumGroupsPerRun)
}

function candidate(members: MacroCalendarRevision[], now: number): BeaOfficialReleaseCandidate | undefined {
  const group = groupFor(members)
  if (!group || !due(group, now)) return undefined
  return Object.freeze({ group, scheduleFingerprint: createHash('sha256').update(JSON.stringify(members.map((member) => [member.eventKey, member.scheduledDate, member.scheduledAt, member.snapshotHash]).sort())).digest('hex') })
}
function groupFor(members: MacroCalendarRevision[]): BeaReleaseGroup | undefined {
  const one = members[0]
  if (!one || members.some((member) => member.releaseGroupKey !== one.releaseGroupKey || member.periodKey !== one.periodKey || member.scheduledDate !== one.scheduledDate || member.scheduledAt !== one.scheduledAt)) return undefined
  if (one.releaseGroupKey === `US.BEA.PCE.${one.periodKey}` && members.length === 2) {
    const keys = members.map((member) => member.eventKey).sort()
    if (keys[0] === `US.CORE_PCE.${one.periodKey}` && keys[1] === `US.PCE.${one.periodKey}` && members.every((member) => member.eventNameKey === member.eventFamily && (member.eventFamily === 'pce' || member.eventFamily === 'core-pce'))) {
      return Object.freeze({ kind: 'pce-core', releaseGroupKey: one.releaseGroupKey as `US.BEA.PCE.${string}`, periodKey: one.periodKey as `${number}-${string}`, scheduledDate: one.scheduledDate, ...(one.scheduledAt ? { scheduledAt: one.scheduledAt } : {}), eventKeys: [`US.PCE.${one.periodKey}`, `US.CORE_PCE.${one.periodKey}`] as const })
    }
  }
  const gdp = /^US\.BEA\.GDP\.(\d{4}-Q[1-4])\.(ADVANCE|SECOND|THIRD)$/.exec(one.releaseGroupKey)
  if (gdp && members.length === 1 && one.eventKey === `US.GDP.${gdp[1]}.${gdp[2]}` && one.eventFamily === 'gdp' && one.periodKey === gdp[1]) {
    return Object.freeze({ kind: 'gdp', releaseGroupKey: one.releaseGroupKey as `US.BEA.GDP.${string}.${'ADVANCE' | 'SECOND' | 'THIRD'}`, periodKey: gdp[1] as `${number}-Q${1 | 2 | 3 | 4}`, variant: gdp[2] as 'ADVANCE' | 'SECOND' | 'THIRD', scheduledDate: one.scheduledDate, ...(one.scheduledAt ? { scheduledAt: one.scheduledAt } : {}), eventKeys: [one.eventKey as `US.GDP.${string}`] as const })
  }
  return undefined
}
function due(group: BeaReleaseGroup, now: number): boolean {
  if (group.scheduledAt) {
    const dueAt = timestamp(group.scheduledAt)
    return dueAt !== undefined && now >= dueAt && now - dueAt <= beaOfficialReleasePollingPolicy.delayedObservationWindowMs
  }
  const dateStart = toUtcIsoFromOfficialEasternTime(group.scheduledDate, beaOfficialReleasePollingPolicy.dateOnlyStartTime)
  const dateStartMs = dateStart ? timestamp(dateStart) : undefined
  return dateStartMs !== undefined && now >= dateStartMs && now - dateStartMs <= beaOfficialReleasePollingPolicy.delayedObservationWindowMs
}
function isBeaSchedule(revision: MacroCalendarRevision): boolean { return revision.providerId === beaOfficialReleasePollingPolicy.providerId && revision.descriptorId === beaOfficialReleasePollingPolicy.scheduleDescriptorId && revision.revisionKind === 'schedule' && revision.lifecycleState === 'scheduled' && revision.actual === undefined }
function timestamp(value: string): number | undefined { return beaOfficialReleasePollingPolicy.canonicalUtcMillisPattern.test(value) && new Date(value).toISOString() === value ? Date.parse(value) : undefined }
