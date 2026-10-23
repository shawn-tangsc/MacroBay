import type { InstalledSkill, SkillSearchResult } from '@platform/ai/agent-platform/schemas/skillSchemas'

export type SkillMarketplaceRow = SkillSearchResult & {
  isInstalled: boolean
  statsText: string
}

export function buildSkillMarketplaceRows(
  results: readonly SkillSearchResult[],
  installedSkills: readonly InstalledSkill[]
): SkillMarketplaceRow[] {
  const installedNames = new Set(installedSkills.map((skill) => normalizeName(skill.name)))

  return results.map((result) => ({
    ...result,
    isInstalled: installedNames.has(normalizeName(result.name)),
    statsText: formatStats(result)
  }))
}

function formatStats(result: SkillSearchResult): string {
  const parts: string[] = []
  if (result.stars > 0) parts.push(`${result.stars} stars`)
  if (result.downloads > 0) parts.push(`${result.downloads} installs`)
  return parts.length > 0 ? parts.join(' · ') : result.sourceRegistry
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}
