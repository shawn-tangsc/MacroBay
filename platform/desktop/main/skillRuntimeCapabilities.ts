import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import type {
  AgentSkillRuntimeCapability,
  AgentSkillRuntimeEntryFile
} from '../../ai/agent-platform/skills/skillRuntimeSchemas'
import type { InstalledSkill } from '../../ai/agent-platform/schemas/skillSchemas'

const skillEntryFileNames = ['SKILL.md', 'skill.md'] as const
const defaultMaxBodyPreviewChars = 600
const defaultMaxCapabilityFiles = 8
const supportedCapabilityFileExtensions = new Set(['.md', '.markdown', '.mdx', '.txt'])

export type SkillRuntimeCapabilityResolverOptions = {
  skillsRoot: string
  maxBodyPreviewChars?: number
  maxCapabilityFiles?: number
}

export function createSkillRuntimeCapabilityResolver(
  options: SkillRuntimeCapabilityResolverOptions
): (skill: InstalledSkill) => AgentSkillRuntimeCapability[] {
  const skillsRoot = resolve(options.skillsRoot)
  const maxBodyPreviewChars = options.maxBodyPreviewChars ?? defaultMaxBodyPreviewChars
  const maxCapabilityFiles = Math.max(0, options.maxCapabilityFiles ?? defaultMaxCapabilityFiles)

  return (skill) => {
    const skillRoot = resolve(skillsRoot, skill.folderName)
    if (!isPathInside(skillRoot, skillsRoot)) return []

    const entryFile = findSkillEntryFile(skillRoot)
    if (!entryFile) return []

    try {
      const content = readFileSync(entryFile.path, 'utf8')
      const parsed = parseSkillEntryFile(content)
      const sourcePath = relative(skillRoot, entryFile.path) || basename(entryFile.path)
      const bodyPreview = buildBodyPreview(parsed.body, maxBodyPreviewChars)
      const capabilities: AgentSkillRuntimeCapability[] = [
        {
          capabilityId: `${skill.id}:${sourcePath}`,
          kind: 'entry-file-summary',
          title: parsed.name ?? skill.name,
          summary: parsed.description ?? skill.description,
          sourcePath,
          entryFile: entryFile.entryFile,
          bodyPreview: bodyPreview.text,
          bodyPreviewTruncated: bodyPreview.truncated
        }
      ]
      for (const capabilityFile of resolveCapabilityFiles(skillRoot, parsed.capabilityFiles, maxCapabilityFiles)) {
        try {
          const supportingContent = readFileSync(capabilityFile.path, 'utf8')
          const supportingParsed = parseSkillEntryFile(supportingContent)
          const supportingPreview = buildBodyPreview(supportingParsed.body, maxBodyPreviewChars)
          capabilities.push({
            capabilityId: `${skill.id}:${capabilityFile.sourcePath}`,
            kind: 'supporting-file-summary',
            title: supportingParsed.name ?? basename(capabilityFile.sourcePath),
            summary: supportingParsed.description,
            sourcePath: capabilityFile.sourcePath,
            bodyPreview: supportingPreview.text,
            bodyPreviewTruncated: supportingPreview.truncated
          })
        } catch {
          // Ignore unreadable declared supporting files; entry-file capability remains useful.
        }
      }
      return capabilities
    } catch {
      return []
    }
  }
}

export function createSkillRuntimeToolsResolver(
  options: SkillRuntimeCapabilityResolverOptions
): (skill: InstalledSkill) => string[] {
  const skillsRoot = resolve(options.skillsRoot)

  return (skill) => {
    const skillRoot = resolve(skillsRoot, skill.folderName)
    if (!isPathInside(skillRoot, skillsRoot)) return []

    const entryFile = findSkillEntryFile(skillRoot)
    if (!entryFile) return []

    try {
      const content = readFileSync(entryFile.path, 'utf8')
      return dedupeTools(parseSkillEntryFile(content).tools)
    } catch {
      return []
    }
  }
}

function findSkillEntryFile(skillRoot: string): { path: string; entryFile: AgentSkillRuntimeEntryFile } | null {
  let entries: string[]
  try {
    entries = readdirSync(skillRoot)
  } catch {
    return null
  }

  for (const fileName of skillEntryFileNames) {
    const matchedEntry = entries.find((entry) => entry === fileName)
    if (matchedEntry) {
      return {
        path: join(skillRoot, matchedEntry),
        entryFile: fileName
      }
    }
  }
  return null
}

function parseSkillEntryFile(content: string): {
  name: string | null
  description: string | null
  tools: string[]
  capabilityFiles: string[]
  body: string
} {
  const lines = content.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') {
    return {
      name: null,
      description: null,
      tools: [],
      capabilityFiles: [],
      body: content
    }
  }

  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (endIndex === -1) {
    return {
      name: null,
      description: null,
      tools: [],
      capabilityFiles: [],
      body: content
    }
  }

  const frontmatter = parseFrontmatter(lines.slice(1, endIndex))
  return {
    name: normalizeText(typeof frontmatter.name === 'string' ? frontmatter.name : null),
    description: normalizeText(typeof frontmatter.description === 'string' ? frontmatter.description : null),
    tools: normalizeTools(frontmatter.tools),
    capabilityFiles: normalizeStringList(frontmatter.capabilityFiles),
    body: lines.slice(endIndex + 1).join('\n')
  }
}

function parseFrontmatter(lines: readonly string[]): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {}
  let activeListKey: string | null = null
  let activeList: string[] = []

  function flushList(): void {
    if (!activeListKey) return
    result[activeListKey] = [...activeList]
    activeListKey = null
    activeList = []
  }

  for (const line of lines) {
    const listMatch = line.match(/^\s*-\s*(.*)$/)
    if (listMatch && activeListKey) {
      activeList.push(stripQuotes(listMatch[1].trim()))
      continue
    }

    const pairMatch = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/)
    if (!pairMatch) continue
    flushList()

    const key = pairMatch[1]
    if (key !== 'name' && key !== 'description' && key !== 'tools' && key !== 'capabilityFiles') continue

    const rawValue = pairMatch[2].trim()
    if (!rawValue && (key === 'tools' || key === 'capabilityFiles')) {
      activeListKey = key
      activeList = []
      continue
    }
    result[key] = parseFrontmatterValue(rawValue)
  }

  flushList()
  return result
}

function parseFrontmatterValue(rawValue: string): string | string[] {
  const stripped = stripQuotes(rawValue)
  if (stripped.startsWith('[') && stripped.endsWith(']')) {
    return stripped
      .slice(1, -1)
      .split(',')
      .map((item) => stripQuotes(item.trim()))
      .filter(Boolean)
  }
  return stripped
}

function buildBodyPreview(body: string, maxChars: number): { text: string | null; truncated: boolean } {
  const cleaned = body
    .replace(/^#+\s+.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return { text: null, truncated: false }
  if (cleaned.length <= maxChars) return { text: cleaned, truncated: false }
  return {
    text: `${cleaned.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`,
    truncated: true
  }
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed ? trimmed : null
}

function normalizeTools(value: string | string[] | null | undefined): string[] {
  return normalizeStringList(value)
}

function normalizeStringList(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) return dedupeTools(value)
  if (typeof value === 'string') {
    return dedupeTools(value.split(','))
  }
  return []
}

function dedupeTools(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const tools: string[] = []

  for (const value of values) {
    const tool = value.trim()
    if (!tool || seen.has(tool)) continue
    seen.add(tool)
    tools.push(tool)
  }

  return tools
}

function resolveCapabilityFiles(
  skillRoot: string,
  declaredPaths: readonly string[],
  maxFiles: number
): Array<{ path: string; sourcePath: string }> {
  const files: Array<{ path: string; sourcePath: string }> = []
  const seen = new Set<string>()

  for (const declaredPath of declaredPaths) {
    if (files.length >= maxFiles) break
    const normalizedPath = declaredPath.trim()
    if (!normalizedPath || isAbsolute(normalizedPath)) continue
    const filePath = resolve(skillRoot, normalizedPath)
    if (!isPathInside(filePath, skillRoot)) continue
    if (!supportedCapabilityFileExtensions.has(extname(filePath).toLowerCase())) continue

    const sourcePath = toPosixPath(relative(skillRoot, filePath))
    if (!sourcePath || seen.has(sourcePath)) continue

    try {
      const info = statSync(filePath)
      if (!info.isFile()) continue
    } catch {
      continue
    }

    seen.add(sourcePath)
    files.push({ path: filePath, sourcePath })
  }

  return files
}

function toPosixPath(value: string): string {
  return value.split(sep).join('/')
}

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function isPathInside(candidate: string, parent: string): boolean {
  const relativePath = relative(parent, candidate)
  return relativePath === '' || (!relativePath.startsWith('..') && !relativePath.startsWith(sep))
}
