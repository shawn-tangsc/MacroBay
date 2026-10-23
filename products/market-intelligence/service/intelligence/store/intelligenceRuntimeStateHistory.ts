import type { RuntimeStateRecord } from '@platform/jobs'

import { compareIsoTime, isVisibleAsOf } from '../public-query/asOfVisibility'

export function resolveRuntimeStatesAsOf(revisions: RuntimeStateRecord[], asOf: string): RuntimeStateRecord[] {
  const byResource = new Map<string, RuntimeStateRecord>()

  for (const revision of revisions) {
    if (!revision.resourceId?.trim()) continue
    if (!isVisibleAsOf(revision.updatedAt, asOf)) continue

    const existing = byResource.get(revision.resourceId)
    if (!existing || compareIsoTime(revision.updatedAt, existing.updatedAt) > 0) {
      byResource.set(revision.resourceId, revision)
    }
  }

  return [...byResource.values()]
}

export function appendRuntimeStateRevision(
  revisions: RuntimeStateRecord[],
  next: RuntimeStateRecord
): RuntimeStateRecord[] {
  const previous = revisions[revisions.length - 1]
  if (previous && runtimeStateRevisionEquals(previous, next)) {
    return revisions
  }
  return [...revisions, next]
}

export function seedRuntimeStateRevisions(
  revisions: RuntimeStateRecord[],
  snapshot: RuntimeStateRecord[]
): RuntimeStateRecord[] {
  if (revisions.length > 0) return revisions
  return snapshot.map((record) => ({ ...record }))
}

function runtimeStateRevisionEquals(left: RuntimeStateRecord, right: RuntimeStateRecord): boolean {
  return (
    left.resourceId === right.resourceId &&
    left.updatedAt === right.updatedAt &&
    left.status === right.status &&
    left.lastSuccessAt === right.lastSuccessAt &&
    left.lastFailureAt === right.lastFailureAt &&
    left.consecutiveFailures === right.consecutiveFailures
  )
}
