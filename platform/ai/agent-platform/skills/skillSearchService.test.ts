import { describe, expect, it } from 'vitest'

import {
  createSkillSearchService,
  normalizeClaudePluginsSearch,
  normalizeClawhubSearch,
  normalizeSkillsShSearch,
  type SkillSearchJsonFetcher
} from './skillSearchService'

describe('skill search service', () => {
  it('normalizes claude-plugins results into installable marketplace handles', () => {
    const results = normalizeClaudePluginsSearch({
      skills: [
        {
          id: 'reader',
          name: 'Code Reader',
          namespace: 'anthropic',
          description: 'Reads code',
          author: 'Anthropic',
          stars: 42,
          installs: 100,
          metadata: {
            repoOwner: 'anthropic',
            repoName: 'skills',
            directoryPath: 'skills/code-reader'
          }
        }
      ]
    })

    expect(results).toEqual([
      {
        slug: 'reader',
        name: 'Code Reader',
        description: 'Reads code',
        author: 'Anthropic',
        stars: 42,
        downloads: 100,
        sourceRegistry: 'claude-plugins.dev',
        sourceUrl: 'https://github.com/anthropic/skills/tree/main/skills/code-reader',
        installSource: 'claude-plugins:anthropic/skills/skills/code-reader'
      }
    ])
  })

  it('normalizes skills.sh results into installable marketplace handles', () => {
    const results = normalizeSkillsShSearch({
      query: 'code',
      count: 1,
      skills: [
        {
          id: 'owner/repo/code-reader',
          skillId: 'code-reader',
          name: 'Code Reader',
          installs: 7,
          source: 'owner/repo'
        }
      ]
    })

    expect(results).toEqual([
      {
        slug: 'owner/repo/code-reader',
        name: 'Code Reader',
        description: null,
        author: 'owner',
        stars: 0,
        downloads: 7,
        sourceRegistry: 'skills.sh',
        sourceUrl: 'https://github.com/owner/repo',
        installSource: 'skills.sh:owner/repo/code-reader'
      }
    ])
  })

  it('normalizes clawhub results into installable marketplace handles', () => {
    const results = normalizeClawhubSearch({
      results: [
        {
          score: 0.91,
          slug: 'code-reader',
          displayName: 'Code Reader',
          summary: 'Reads code',
          version: '1.0.0',
          updatedAt: 1780000000000
        }
      ]
    })

    expect(results).toEqual([
      {
        slug: 'code-reader',
        name: 'Code Reader',
        description: 'Reads code',
        author: null,
        stars: 0,
        downloads: 0,
        sourceRegistry: 'clawhub.ai',
        sourceUrl: 'https://clawhub.ai/skills/code-reader',
        installSource: 'clawhub:code-reader'
      }
    ])
  })

  it('searches all registries, ignores failed sources, and dedupes by case-insensitive name', async () => {
    const requestedUrls: string[] = []
    const fetchJson: SkillSearchJsonFetcher = async (url) => {
      requestedUrls.push(url)
      if (url.startsWith('https://skills.sh')) {
        return {
          query: 'reader',
          count: 1,
          skills: [{ id: 'owner/repo/code-reader', skillId: 'code-reader', name: 'Code Reader', installs: 9, source: 'owner/repo' }]
        }
      }
      if (url.startsWith('https://claude-plugins.dev')) {
        return {
          skills: [
            {
              id: 'duplicate',
              name: 'code reader',
              namespace: 'anthropic',
              metadata: { repoOwner: 'anthropic', repoName: 'skills', directoryPath: 'skills/code-reader' }
            }
          ]
        }
      }
      throw new Error('clawhub unavailable')
    }
    const service = createSkillSearchService({ fetchJson })

    const results = await service.search('reader')

    expect(requestedUrls).toHaveLength(3)
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      name: 'Code Reader',
      sourceRegistry: 'skills.sh',
      installSource: 'skills.sh:owner/repo/code-reader'
    })
  })

  it('returns no results for blank queries', async () => {
    const service = createSkillSearchService({
      fetchJson: async () => {
        throw new Error('should not fetch')
      }
    })

    await expect(service.search('   ')).resolves.toEqual([])
  })
})
