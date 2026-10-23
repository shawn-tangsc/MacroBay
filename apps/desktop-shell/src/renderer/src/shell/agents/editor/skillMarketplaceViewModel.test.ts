import { describe, expect, it } from 'vitest'

import type { InstalledSkill, SkillSearchResult } from '@platform/ai/agent-platform/schemas/skillSchemas'

import { buildSkillMarketplaceRows } from './skillMarketplaceViewModel'

const installedSkill: InstalledSkill = {
  id: 'skill-1',
  name: 'Code Reader',
  description: 'Reads code',
  folderName: 'code-reader',
  source: 'marketplace',
  sourceUrl: 'https://github.com/owner/repo',
  namespace: null,
  author: 'owner',
  sourceTags: [],
  contentHash: 'hash',
  isEnabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const marketplaceResult: SkillSearchResult = {
  slug: 'owner/repo/code-reader',
  name: 'Code Reader',
  description: 'Reads code',
  author: 'owner',
  stars: 12,
  downloads: 35,
  sourceRegistry: 'skills.sh',
  sourceUrl: 'https://github.com/owner/repo',
  installSource: 'skills.sh:owner/repo/code-reader'
}

describe('skill marketplace view model', () => {
  it('marks marketplace results as installed by normalized skill name', () => {
    const rows = buildSkillMarketplaceRows([marketplaceResult], [installedSkill])

    expect(rows[0]).toMatchObject({
      name: 'Code Reader',
      isInstalled: true,
      statsText: '12 stars · 35 installs'
    })
  })

  it('falls back to source labels when marketplace stats are empty', () => {
    const rows = buildSkillMarketplaceRows(
      [
        {
          ...marketplaceResult,
          name: 'Plan Writer',
          stars: 0,
          downloads: 0,
          sourceRegistry: 'clawhub.ai'
        }
      ],
      []
    )

    expect(rows[0]).toMatchObject({
      isInstalled: false,
      statsText: 'clawhub.ai'
    })
  })
})
