import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { getIntelligenceSourceDefinition } from '../application/sourceCatalog'
import { createDefaultSourceProfile, resolveAndValidateRuntimeConfig } from '../application/sourceRuntimeConfig'
import { htmlPagePollerAdapter } from './htmlPagePoller'
import {
  buildOkxAnnouncementsQueryUrl,
  normalizeOkxPublishedAt,
  parseOkxAnnouncementPayload,
  parseOkxAnnouncementsResponse
} from './okxAnnouncementsParser'
import type { IntelligenceSourceConfig } from '../schema/intelligenceSource'

describe('parseOkxAnnouncementsResponse', () => {
  it('parses the synthetic latest-announcements fixture, keeping OKX identity and publish times', () => {
    const announcements = parseOkxAnnouncementsResponse(loadFixture('okx-announcements-latest-sample.json'))
    expect(announcements.length).toBe(20)
    for (const announcement of announcements) {
      expect(announcement.title.length).toBeGreaterThan(0)
      expect(announcement.url.startsWith('https://www.okx.com/help/')).toBe(true)
      expect(Number.isNaN(Date.parse(announcement.publishedAt))).toBe(false)
      // Epoch milliseconds on this endpoint, not the seconds the older search payload used.
      expect(new Date(announcement.publishedAt).getUTCFullYear()).toBeGreaterThan(2025)
    }
  })

  it('parses the synthetic API-announcements fixture', () => {
    const announcements = parseOkxAnnouncementsResponse(loadFixture('okx-announcements-api-sample.json'))
    expect(announcements.length).toBe(11)
    expect(announcements.every((announcement) => announcement.annType === 'announcements-api')).toBe(true)
    expect(announcements[0]?.url).toBe('https://www.okx.com/help/synthetic-announcements-api-1')
  })

  it('drops rows with a missing title, missing url or an inadmissible timestamp', () => {
    const announcements = parseOkxAnnouncementsResponse(
      JSON.stringify({
        code: '0',
        data: [
          {
            details: [
              { annType: 'announcements-api', title: 'Kept', url: 'https://www.okx.com/help/kept', pTime: '1790758418444' },
              { title: 'No url', pTime: '1790758418444' },
              { title: 'No time', url: 'https://www.okx.com/help/no-time' },
              { title: 'Bad time', url: 'https://www.okx.com/help/bad-time', pTime: 'not-a-time' },
              { title: 'Zero time', url: 'https://www.okx.com/help/zero', pTime: '0' },
              { title: 'Ancient', url: 'https://www.okx.com/help/ancient', pTime: '1' },
              { title: '   ', url: 'https://www.okx.com/help/blank', pTime: '1790758418444' }
            ]
          }
        ]
      })
    )
    expect(announcements.map((announcement) => announcement.title)).toEqual(['Kept'])
  })

  it('reads an empty details list as "nothing published", not as a parse failure', () => {
    expect(parseOkxAnnouncementsResponse(JSON.stringify({ code: '0', data: [{ details: [] }] }))).toEqual([])
  })

  it('fails loudly when OKX rejects the request', () => {
    expect(() => parseOkxAnnouncementsResponse('{"code":"51000","msg":"Parameter annType error","data":[]}')).toThrow(
      /51000/
    )
  })

  it('fails loudly when the response shape changed', () => {
    expect(() => parseOkxAnnouncementsResponse('{"code":"0","data":[{"totalPage":"96"}]}')).toThrow(/no details list/)
    expect(() =>
      parseOkxAnnouncementsResponse(JSON.stringify({ code: '0', data: [{ details: [{ title: 'x' }] }] }))
    ).toThrow(/no usable rows/)
  })
})

describe('normalizeOkxPublishedAt', () => {
  it('accepts epoch milliseconds and upscales epoch seconds', () => {
    expect(normalizeOkxPublishedAt('1790758418444')).toBe('2026-09-30T08:53:38.444Z')
    expect(normalizeOkxPublishedAt('1790758418')).toBe('2026-09-30T08:53:38.000Z')
  })

  it('drops unusable values instead of inventing a date', () => {
    for (const value of [undefined, null, '', 'abc', '0', '-1', '1', '99999999999999', {}]) {
      expect(normalizeOkxPublishedAt(value)).toBeUndefined()
    }
  })
})

describe('parseOkxAnnouncementPayload', () => {
  it('builds the item from a stored announcement record', () => {
    const parsed = parseOkxAnnouncementPayload({
      annType: 'announcements-api',
      title: 'OKX WebSocket Port 8443 Discontinuation Announcement',
      url: 'https://www.okx.com/help/okx-websocket-port-8443-discontinuation-announcement',
      pTime: '1790758418444'
    })
    expect(parsed.externalId).toBe('okx-websocket-port-8443-discontinuation-announcement')
    expect(parsed.eventType).toBe('exchange-announcement')
    expect(parsed.publishedAt).toBe('2026-09-30T08:53:38.444Z')
  })

  it('refuses a record without a title or url', () => {
    expect(() => parseOkxAnnouncementPayload({ title: 'x', pTime: '1790758418444' })).toThrow(/missing a title/)
    expect(() => parseOkxAnnouncementPayload({ url: 'https://www.okx.com/help/x', pTime: '1790758418444' })).toThrow(
      /missing a title/
    )
  })
})

describe('htmlPagePollerAdapter OKX collection', () => {
  it('collects one raw record per announcement through the injected transport', async () => {
    const fetchText = vi.fn(async () => loadFixture('okx-announcements-api-sample.json'))
    const records = await htmlPagePollerAdapter.collect({
      config: runtimeConfig('okx-api-announcements'),
      runId: 'run-okx-api',
      fetchText
    })

    expect(records.length).toBe(11)
    expect(fetchText.mock.calls[0]?.[0]).toBe(
      'https://www.okx.com/api/v5/support/announcements?annType=announcements-api&page=1'
    )
    const [first] = records
    expect(first?.sourceDedupeKey).toBe('okx:synthetic-announcements-api-1')
    expect(first?.parserVersion).toBe('okx-announcements-v1')
    expect(first?.publishedAt).toBe('2026-09-30T08:53:38.444Z')

    const parsed = htmlPagePollerAdapter.parseRawRecord({ config: runtimeConfig('okx-api-announcements'), rawRecord: first! })
    const normalized = htmlPagePollerAdapter.normalizeParsedItem({
      config: runtimeConfig('okx-api-announcements'),
      parsed,
      rawRecordId: 'raw-1',
      detectedAt: '2026-10-14T00:00:00.000Z'
    })
    expect(normalized.canonicalDedupeKey).toBe('okx:synthetic-announcements-api-1')
    expect(normalized.clusterType).toBe('announcement')
    expect(normalized.url).toContain('https://www.okx.com/help/')
  })

  it('omits annType for the latest-announcements source, which is OKX own aggregate query', async () => {
    const fetchText = vi.fn(async () => loadFixture('okx-announcements-latest-sample.json'))
    const config = runtimeConfig('okx-latest-announcements')
    const records = await htmlPagePollerAdapter.collect({ config, runId: 'run-okx-latest', fetchText })

    expect(records.length).toBe(20)
    expect(fetchText.mock.calls[0]?.[0]).toBe('https://www.okx.com/api/v5/support/announcements?page=1')
    expect(buildOkxAnnouncementsQueryUrl(config)).not.toContain('annType')
  })

  it('collects nothing rather than guessing when the transport is unavailable', async () => {
    const records = await htmlPagePollerAdapter.collect({
      config: runtimeConfig('okx-latest-announcements'),
      runId: 'run-no-transport'
    })
    expect(records).toEqual([])
  })

  it('enables and collects without any credential', () => {
    const definition = getIntelligenceSourceDefinition('okx-api-announcements')!
    const { config, issues } = resolveAndValidateRuntimeConfig({
      definition,
      profile: { ...createDefaultSourceProfile(definition), enabled: true },
      hasCredential: false
    })

    expect(definition.authMode).toBe('none')
    expect(issues).toEqual([])
    expect(config.enabled).toBe(true)
    expect(config.pollingIntervalSec).toBe(30 * 60)
  })
})

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
