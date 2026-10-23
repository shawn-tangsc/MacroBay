import type { SkillSearchResult, SkillSearchSource } from '../schemas/skillSchemas'

const claudePluginsApi = 'https://claude-plugins.dev/api/skills'
const skillsShApi = 'https://skills.sh/api/search'
const clawhubApi = 'https://clawhub.ai/api/v1/search'
const requestTimeoutMs = 15_000

export type SkillSearchJsonFetcher = (url: string) => Promise<unknown>

export type SkillSearchServiceOptions = {
  fetchJson?: SkillSearchJsonFetcher
}

export class SkillSearchService {
  private readonly fetchJson: SkillSearchJsonFetcher

  constructor(options: SkillSearchServiceOptions = {}) {
    this.fetchJson = options.fetchJson ?? fetchJsonWithTimeout
  }

  async search(query: string): Promise<SkillSearchResult[]> {
    const keyword = query.trim()
    if (!keyword) return []

    const searches = [
      this.searchSkillsSh(keyword).catch(() => []),
      this.searchClaudePlugins(keyword).catch(() => []),
      this.searchClawhub(keyword).catch(() => [])
    ]
    const settled = await Promise.allSettled(searches)
    const results = settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))

    return dedupeByName(results)
  }

  private async searchClaudePlugins(query: string): Promise<SkillSearchResult[]> {
    const url = new URL(claudePluginsApi)
    url.searchParams.set('q', query)
    url.searchParams.set('limit', '20')
    return normalizeClaudePluginsSearch(await this.fetchJson(url.toString()))
  }

  private async searchSkillsSh(query: string): Promise<SkillSearchResult[]> {
    const url = new URL(skillsShApi)
    url.searchParams.set('q', query)
    return normalizeSkillsShSearch(await this.fetchJson(url.toString()))
  }

  private async searchClawhub(query: string): Promise<SkillSearchResult[]> {
    const url = new URL(clawhubApi)
    url.searchParams.set('q', query)
    return normalizeClawhubSearch(await this.fetchJson(url.toString()))
  }
}

export function createSkillSearchService(options?: SkillSearchServiceOptions): SkillSearchService {
  return new SkillSearchService(options)
}

export function normalizeClaudePluginsSearch(raw: unknown): SkillSearchResult[] {
  const skills = readArray(readRecord(raw).skills)

  return skills
    .map((item) => {
      const skill = readRecord(item)
      const metadata = readRecord(skill.metadata)
      const repoOwner = readString(metadata.repoOwner)
      const repoName = readString(metadata.repoName)
      const directoryPath = readString(metadata.directoryPath)
      const name = readString(skill.name)
      const slug = readString(skill.id) || name
      if (!name || !repoOwner || !repoName || !directoryPath) return null

      const repoUrl = `https://github.com/${repoOwner}/${repoName}`
      return skillSearchResult({
        slug,
        name,
        description: readNullableString(skill.description),
        author: readNullableString(skill.author) ?? readNullableString(skill.namespace),
        stars: readNumber(skill.stars),
        downloads: readNumber(skill.installs),
        sourceRegistry: 'claude-plugins.dev',
        sourceUrl: readNullableString(skill.sourceUrl) ?? `${repoUrl}/tree/main/${directoryPath}`,
        installSource: `claude-plugins:${repoOwner}/${repoName}/${directoryPath}`
      })
    })
    .filter(isSkillSearchResult)
}

export function normalizeSkillsShSearch(raw: unknown): SkillSearchResult[] {
  const skills = readArray(readRecord(raw).skills)

  return skills
    .map((item) => {
      const skill = readRecord(item)
      const source = readString(skill.source)
      const name = readString(skill.name)
      const slug = readString(skill.id)
      if (!name || !source || !slug) return null

      return skillSearchResult({
        slug,
        name,
        description: null,
        author: source.split('/')[0] ?? null,
        stars: 0,
        downloads: readNumber(skill.installs),
        sourceRegistry: 'skills.sh',
        sourceUrl: `https://github.com/${source}`,
        installSource: `skills.sh:${slug}`
      })
    })
    .filter(isSkillSearchResult)
}

export function normalizeClawhubSearch(raw: unknown): SkillSearchResult[] {
  const results = readArray(readRecord(raw).results)

  return results
    .map((item) => {
      const skill = readRecord(item)
      const slug = readString(skill.slug)
      const name = readString(skill.displayName)
      if (!slug || !name) return null

      return skillSearchResult({
        slug,
        name,
        description: readNullableString(skill.summary),
        author: null,
        stars: 0,
        downloads: 0,
        sourceRegistry: 'clawhub.ai',
        sourceUrl: `https://clawhub.ai/skills/${slug}`,
        installSource: `clawhub:${slug}`
      })
    })
    .filter(isSkillSearchResult)
}

async function fetchJsonWithTimeout(url: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

function dedupeByName(results: SkillSearchResult[]): SkillSearchResult[] {
  const seen = new Set<string>()
  return results.filter((result) => {
    const key = result.name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function skillSearchResult(result: SkillSearchResult): SkillSearchResult {
  return result
}

function isSkillSearchResult(value: SkillSearchResult | null): value is SkillSearchResult {
  return value !== null
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export const skillSearchSources: readonly SkillSearchSource[] = ['claude-plugins.dev', 'skills.sh', 'clawhub.ai']
