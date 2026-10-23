import { hashPayload } from '@platform/jobs'

import { normalizePublishedAt } from '../application/publishedAtNormalizer'
import type { AppendRawRecordInput } from '../schema/intelligenceRecord'
import type { IntelligenceSourceConfig } from '../schema/intelligenceSource'
import type { NormalizedIntelligenceItemDraft, ParsedIntelligenceRecord } from './sourceAdapter'

export const GITHUB_RELEASES_PARSER_VERSION = 'github-releases-v1'

/** GitHub's public releases endpoint answers without any credential; only the rate limit changes. */
const DEFAULT_ENDPOINT_URL = 'https://api.github.com/repos/ethereum/go-ethereum/releases'

/** A publish time outside this window is a broken field, so the release is dropped rather than dated. */
const EARLIEST_ADMITTED_YEAR = 2009
const LATEST_ADMITTED_YEAR = 2100

export type GithubRelease = {
  tagName: string
  repoSlug: string
  name?: string
  htmlUrl: string
  publishedAt: string
  publishedAtRaw: string
  body?: string
  prerelease: boolean
}

type GithubReleasePayload = {
  tag_name?: unknown
  name?: unknown
  html_url?: unknown
  published_at?: unknown
  body?: unknown
  draft?: unknown
  prerelease?: unknown
}

export function buildGithubReleasesQueryUrl(config: IntelligenceSourceConfig): string {
  const url = new URL(String(config.adapterConfig.endpointUrl ?? DEFAULT_ENDPOINT_URL))
  const perPage = Number(config.adapterConfig.perPage)
  if (Number.isSafeInteger(perPage) && perPage > 0) url.searchParams.set('per_page', String(perPage))
  return url.toString()
}

/**
 * Reads GitHub's releases array. A non-array body is a changed contract and throws; individual rows
 * are dropped when a field the item cannot exist without is missing, and drafts are never published
 * as intelligence. A non-empty array that yields nothing usable throws, so a shape change surfaces in
 * source health instead of looking like "this project published nothing".
 */
export function parseGithubReleasesResponse(bodyText: string): GithubRelease[] {
  const payload = JSON.parse(bodyText) as unknown
  if (!Array.isArray(payload)) {
    throw new Error('GitHub releases response was not an array.')
  }

  const releases = new Map<string, GithubRelease>()
  let skipped = 0
  for (const row of payload) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      skipped += 1
      continue
    }
    const record = row as GithubReleasePayload
    if (record.draft === true) continue
    const release = readGithubRelease(record)
    if (!release) {
      skipped += 1
      continue
    }
    releases.set(release.repoSlug + '@' + release.tagName, release)
  }
  if (skipped > 0 && releases.size === 0) {
    throw new Error('GitHub releases response carried no usable rows.')
  }
  return [...releases.values()]
}

function readGithubRelease(record: GithubReleasePayload): GithubRelease | undefined {
  const tagName = typeof record.tag_name === 'string' ? record.tag_name.trim() : ''
  const htmlUrl = typeof record.html_url === 'string' ? record.html_url.trim() : ''
  const publishedAtRaw = typeof record.published_at === 'string' ? record.published_at.trim() : ''
  const publishedAt = normalizeReleasePublishedAt(publishedAtRaw)
  // A release without a resolvable link cannot be read back to its source, so it is not published.
  if (!tagName || !isHttpUrl(htmlUrl) || !publishedAt) return undefined

  const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : undefined
  const body = typeof record.body === 'string' && record.body.trim() ? record.body.trim() : undefined
  return {
    tagName,
    repoSlug: readRepoSlug(htmlUrl) ?? tagName,
    ...(name ? { name } : {}),
    htmlUrl,
    publishedAt,
    publishedAtRaw,
    ...(body ? { body } : {}),
    prerelease: record.prerelease === true
  }
}

function normalizeReleasePublishedAt(raw: string): string | undefined {
  const publishedAt = normalizePublishedAt(raw)
  if (!publishedAt) return undefined
  const year = new Date(publishedAt).getUTCFullYear()
  return year >= EARLIEST_ADMITTED_YEAR && year <= LATEST_ADMITTED_YEAR ? publishedAt : undefined
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/** `https://github.com/<owner>/<repo>/releases/tag/<tag>` → `<owner>/<repo>`. */
function readRepoSlug(htmlUrl: string): string | undefined {
  try {
    const segments = new URL(htmlUrl).pathname.split('/').filter(Boolean)
    return segments.length >= 2 && segments[0] && segments[1] ? `${segments[0]}/${segments[1]}` : undefined
  } catch {
    return undefined
  }
}

export function buildGithubReleaseExternalId(release: Pick<GithubRelease, 'repoSlug' | 'tagName'>): string {
  return `${release.repoSlug}@${release.tagName}`
}

export function buildGithubReleaseDedupeKey(release: Pick<GithubRelease, 'repoSlug' | 'tagName'>): string {
  return `github:${buildGithubReleaseExternalId(release)}`
}

export function githubReleasesToRawRecords(input: {
  config: IntelligenceSourceConfig
  runId: string
  releases: GithubRelease[]
}): AppendRawRecordInput[] {
  return input.releases.map((release) => {
    const payloadBody = JSON.stringify(release)
    return {
      sourceId: input.config.sourceId,
      runId: input.runId,
      externalId: buildGithubReleaseExternalId(release),
      sourceUrl: release.htmlUrl,
      publishedAt: release.publishedAt,
      publishedAtRaw: release.publishedAtRaw,
      payloadFormat: 'json',
      payloadRefType: 'inline',
      payloadBody,
      payloadHash: hashPayload(payloadBody),
      sourceDedupeKey: buildGithubReleaseDedupeKey(release),
      parserVersion: GITHUB_RELEASES_PARSER_VERSION
    }
  })
}

export function isGithubReleasePayload(bodyText: string): boolean {
  if (!bodyText.trimStart().startsWith('{')) return false
  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>
    return typeof parsed.tagName === 'string' && typeof parsed.htmlUrl === 'string'
  } catch {
    return false
  }
}

export function parseGithubReleasePayload(payload: unknown): ParsedIntelligenceRecord {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('GitHub release payload is not an object.')
  }
  const record = payload as Partial<GithubRelease>
  const tagName = typeof record.tagName === 'string' ? record.tagName.trim() : ''
  const htmlUrl = typeof record.htmlUrl === 'string' ? record.htmlUrl.trim() : ''
  const publishedAt = normalizeReleasePublishedAt(String(record.publishedAt ?? ''))
  if (!tagName || !htmlUrl || !publishedAt) {
    throw new Error('GitHub release payload is missing a tag, url or a valid publish time.')
  }

  const title = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : tagName
  const body = typeof record.body === 'string' ? record.body.trim() : ''
  const bodyText = [title, body].filter(Boolean).join('\n\n')
  return {
    externalId: typeof record.repoSlug === 'string' && record.repoSlug ? `${record.repoSlug}@${tagName}` : tagName,
    sourceUrl: htmlUrl,
    publishedAtRaw: String(record.publishedAtRaw ?? record.publishedAt ?? ''),
    publishedAt,
    title,
    summary: tagName,
    bodyText: bodyText || title,
    bodyHash: hashPayload(bodyText || title),
    eventType: 'project-release',
    severityHint: 'info'
  }
}

export function normalizeGithubReleaseItem(input: {
  config: IntelligenceSourceConfig
  parsed: ParsedIntelligenceRecord
  detectedAt: string
}): NormalizedIntelligenceItemDraft {
  const externalId = input.parsed.externalId ?? hashPayload(input.parsed.bodyText).slice(0, 16)
  return {
    canonicalDedupeKey: `github:${externalId}`,
    title: input.parsed.title,
    summary: input.parsed.summary,
    url: input.parsed.sourceUrl,
    publishedAt: input.parsed.publishedAt,
    detectedAt: input.detectedAt,
    eventType: input.parsed.eventType,
    severityHint: input.parsed.severityHint,
    clusterKey: `github:${input.config.sourceId}:${externalId}`,
    clusterType: 'news-event'
  }
}
