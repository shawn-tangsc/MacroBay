import type { IntelligenceItemRevision } from '../schema/intelligenceRecord'

export type RevisionCandidate = {
  itemId: string
  canonicalDedupeKey: string
  title: string
  summary?: string
  bodyHash: string
  publishedAt?: string
  detectedAt: string
  revisionKind?: IntelligenceItemRevision['revisionKind']
}

export type RevisionResolverInput = {
  candidate: RevisionCandidate
  existingRevisions: IntelligenceItemRevision[]
}

export type RevisionResolverResult = {
  revision?: IntelligenceItemRevision
  created: boolean
  isDuplicate: boolean
}

export function resolveRevision(input: RevisionResolverInput): RevisionResolverResult {
  const itemRevisions = input.existingRevisions
    .filter((revision) => revision.itemId === input.candidate.itemId)
    .sort((left, right) => left.detectedAt.localeCompare(right.detectedAt))

  const latest = itemRevisions[itemRevisions.length - 1]
  if (!latest) {
    return {
      revision: createRevision(input.candidate, undefined, 'initial'),
      created: true,
      isDuplicate: false
    }
  }

  const latestBodyHash = parseBodyHash(latest.payloadDiffJson)
  if (latestBodyHash === input.candidate.bodyHash) {
    return { revision: latest, created: false, isDuplicate: true }
  }

  return {
    revision: createRevision(
      input.candidate,
      latest.revisionId,
      input.candidate.revisionKind ?? 'update'
    ),
    created: true,
    isDuplicate: false
  }
}

export function buildRssCanonicalDedupeKey(input: {
  guid?: string
  link?: string
  title: string
  publishedAt?: string
}): string {
  if (input.guid) return `rss:guid:${input.guid}`
  if (input.link) return `rss:link:${input.link}`
  const bucket = input.publishedAt ? input.publishedAt.slice(0, 10) : 'unknown-date'
  return `rss:title:${bucket}:${normalizeTitle(input.title)}`
}

function createRevision(
  candidate: RevisionCandidate,
  previousRevisionId: string | undefined,
  revisionKind: IntelligenceItemRevision['revisionKind']
): IntelligenceItemRevision {
  return {
    revisionId: `revision-${candidate.itemId}-${candidate.detectedAt}`,
    itemId: candidate.itemId,
    previousRevisionId,
    revisionKind,
    publishedAt: candidate.publishedAt,
    detectedAt: candidate.detectedAt,
    title: candidate.title,
    summary: candidate.summary,
    payloadDiffJson: JSON.stringify({ bodyHash: candidate.bodyHash }),
    revisionVersion: 'v1'
  }
}

function parseBodyHash(payloadDiffJson: string | undefined): string | undefined {
  if (!payloadDiffJson) return undefined
  try {
    const parsed = JSON.parse(payloadDiffJson) as { bodyHash?: string }
    return parsed.bodyHash
  } catch {
    return undefined
  }
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ')
}
