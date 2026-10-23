import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { getIntelligenceSourceDefinition } from '../application/sourceCatalog'
import { createDefaultSourceProfile, resolveAndValidateRuntimeConfig } from '../application/sourceRuntimeConfig'
import { restApiPollerAdapter } from './restApiPoller'
import {
  buildGithubReleaseDedupeKey,
  parseGithubReleasePayload,
  parseGithubReleasesResponse
} from './githubReleasesParser'
import type { IntelligenceSourceConfig } from '../schema/intelligenceSource'

describe('parseGithubReleasesResponse', () => {
  it('parses the synthetic release fixture', () => {
    const releases = parseGithubReleasesResponse(loadFixture('github-releases-goethereum-sample.json'))
    expect(releases.map((release) => release.tagName)).toEqual(['v9.0.0', 'v8.0.0', 'v7.0.0'])
    const [latest] = releases
    expect(latest?.repoSlug).toBe('example/demo')
    expect(latest?.htmlUrl).toBe('https://github.com/example/demo/releases/tag/v9.0.0')
    expect(latest?.publishedAt).toBe('2026-10-08T12:00:00.000Z')
    expect(latest?.body?.length).toBeGreaterThan(100)
    expect(buildGithubReleaseDedupeKey(latest!)).toBe('github:example/demo@v9.0.0')
  })

  it('drops drafts and rows missing a tag, url or a valid publish time', () => {
    const releases = parseGithubReleasesResponse(
      JSON.stringify([
        release({ tag_name: 'v1', html_url: 'https://github.com/a/b/releases/tag/v1' }),
        release({ tag_name: 'v2', html_url: 'https://github.com/a/b/releases/tag/v2', draft: true }),
        release({ tag_name: '', html_url: 'https://github.com/a/b/releases/tag/v3' }),
        release({ tag_name: 'v4', html_url: '' }),
        release({ tag_name: 'v5', html_url: 'https://github.com/a/b/releases/tag/v5', published_at: 'not-a-date' }),
        release({ tag_name: 'v6', html_url: 'not-a-url' }),
        release({ tag_name: 'v7', html_url: 'https://github.com/a/b/releases/tag/v7', published_at: '1799-01-01T00:00:00Z' })
      ])
    )
    expect(releases.map((row) => row.tagName)).toEqual(['v1'])
  })

  it('reads an empty release list as "nothing published"', () => {
    expect(parseGithubReleasesResponse('[]')).toEqual([])
    expect(parseGithubReleasesResponse(JSON.stringify([release({ tag_name: 'v1', draft: true })]))).toEqual([])
  })

  it('fails loudly when the response shape changed', () => {
    expect(() => parseGithubReleasesResponse('{"message":"Not Found"}')).toThrow(/was not an array/)
    expect(() => parseGithubReleasesResponse(JSON.stringify([{ id: 1 }, { id: 2 }]))).toThrow(/no usable rows/)
  })
})

describe('parseGithubReleasePayload', () => {
  it('builds the item from a stored release record', () => {
    const [latest] = parseGithubReleasesResponse(loadFixture('github-releases-goethereum-sample.json'))
    const parsed = parseGithubReleasePayload(JSON.parse(JSON.stringify(latest)))
    expect(parsed.externalId).toBe('example/demo@v9.0.0')
    expect(parsed.title).toBe('Example release v9.0.0')
    expect(parsed.eventType).toBe('project-release')
    expect(parsed.bodyText).toContain('Synthetic release notes for v9.0.0')
  })

  it('refuses a record that lost its identity', () => {
    expect(() => parseGithubReleasePayload({ tagName: 'v1' })).toThrow(/missing a tag/)
    expect(() => parseGithubReleasePayload({ tagName: 'v1', htmlUrl: 'https://github.com/a/b' })).toThrow(
      /missing a tag/
    )
  })
})

describe('restApiPollerAdapter github releases collection', () => {
  it('collects one raw record per release through the injected transport', async () => {
    const fetchText = vi.fn(async () => loadFixture('github-releases-goethereum-sample.json'))
    const config = runtimeConfig('github-releases')
    const records = await restApiPollerAdapter.collect({ config, runId: 'run-gh', fetchText })

    expect(records.length).toBe(3)
    expect(fetchText.mock.calls[0]?.[0]).toBe(
      'https://api.github.com/repos/ethereum/go-ethereum/releases?per_page=3'
    )
    const [first] = records
    expect(first?.sourceDedupeKey).toBe('github:example/demo@v9.0.0')
    expect(first?.parserVersion).toBe('github-releases-v1')

    const parsed = restApiPollerAdapter.parseRawRecord({ config, rawRecord: first! })
    const normalized = restApiPollerAdapter.normalizeParsedItem({
      config,
      parsed,
      rawRecordId: 'raw-1',
      detectedAt: '2026-10-14T00:00:00.000Z'
    })
    expect(normalized.canonicalDedupeKey).toBe('github:example/demo@v9.0.0')
    expect(normalized.clusterType).toBe('news-event')
    expect(normalized.url).toContain('https://github.com/example/demo/releases/tag/')
  })

  it('enables and collects without any credential, on the manual preset it declares', () => {
    const definition = getIntelligenceSourceDefinition('github-releases')!
    const { config, issues } = resolveAndValidateRuntimeConfig({
      definition,
      profile: { ...createDefaultSourceProfile(definition), enabled: true },
      hasCredential: false
    })

    // Anonymous collection is the supported path; a token is optional and only raises the rate limit.
    expect(definition.authMode).toBe('optional-api-key')
    expect(definition.supportsRunNow).toBe(true)
    expect(issues).toEqual([])
    expect(config.enabled).toBe(true)
    // Manual: enabling must not quietly arm a schedule against the anonymous rate limit.
    expect(config.pollingIntervalSec).toBeUndefined()
  })
})

function release(patch: Record<string, unknown>) {
  return {
    tag_name: 'v0',
    html_url: 'https://github.com/a/b/releases/tag/v0',
    published_at: '2026-10-08T16:35:36Z',
    draft: false,
    name: 'Geth v0',
    body: 'notes',
    ...patch
  }
}

function runtimeConfig(sourceId: string): IntelligenceSourceConfig {
  const definition = getIntelligenceSourceDefinition(sourceId)!
  return resolveAndValidateRuntimeConfig({
    definition,
    profile: { ...createDefaultSourceProfile(definition), enabled: true }
  }).config
}

function loadFixture(name: string): string {
  return readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')
}
