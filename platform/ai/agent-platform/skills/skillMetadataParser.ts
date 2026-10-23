import { createHash } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'

import type { SkillMetadata } from '../schemas/skillSchemas'

const skillFileNames = ['SKILL.md', 'skill.md'] as const

export async function findSkillMdPath(dirPath: string): Promise<string | null> {
  for (const filename of skillFileNames) {
    const filePath = join(dirPath, filename)
    try {
      const info = await stat(filePath)
      if (info.isFile()) return filePath
    } catch {
      // Try the next supported file name.
    }
  }
  return null
}

export async function parseSkillMetadata(skillFolderPath: string): Promise<SkillMetadata> {
  const skillFilePath = await findSkillMdPath(skillFolderPath)
  if (!skillFilePath) throw new Error(`SKILL.md not found in ${skillFolderPath}`)

  const content = await readFile(skillFilePath, 'utf8')
  const frontmatter = parseFrontmatter(content)
  const folderName = basename(skillFolderPath)

  return {
    name: stringValue(frontmatter.name)?.trim() || folderName,
    description: stringValue(frontmatter.description),
    folderName,
    author: stringValue(frontmatter.author),
    tags: stringArrayValue(frontmatter.tags),
    tools: stringArrayValue(frontmatter.tools),
    contentHash: createHash('sha256').update(content).digest('hex'),
    skillFilePath
  }
}

export async function findAllSkillDirectories(
  dirPath: string,
  basePath = dirPath,
  maxDepth = 10,
  currentDepth = 0,
  seen: Set<string> = new Set()
): Promise<Array<{ folderPath: string; sourcePath: string }>> {
  if (currentDepth > maxDepth) return []

  if (await findSkillMdPath(dirPath)) {
    const folderName = basename(dirPath)
    if (seen.has(folderName)) return []
    seen.add(folderName)
    return [{ folderPath: dirPath, sourcePath: relative(basePath, dirPath) }]
  }

  let entries: Dirent[]
  try {
    entries = await readdir(dirPath, { withFileTypes: true })
  } catch {
    return []
  }

  const results: Array<{ folderPath: string; sourcePath: string }> = []
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const childPath = join(dirPath, entry.name)
    if (entry.isSymbolicLink()) {
      try {
        const childStats = await stat(childPath)
        if (!childStats.isDirectory()) continue
      } catch {
        continue
      }
    }
    results.push(...(await findAllSkillDirectories(childPath, basePath, maxDepth, currentDepth + 1, seen)))
  }
  return results
}

function parseFrontmatter(content: string): Record<string, unknown> {
  const lines = content.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return {}

  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (endIndex === -1) return {}

  const result: Record<string, unknown> = {}
  let activeKey: string | null = null
  let activeList: string[] = []

  function flushList(): void {
    if (!activeKey) return
    if (activeList.length > 0) result[activeKey] = activeList
    activeKey = null
    activeList = []
  }

  for (const line of lines.slice(1, endIndex)) {
    const listMatch = line.match(/^\s*-\s*(.*)$/)
    if (listMatch && activeKey) {
      activeList.push(stripQuotes(listMatch[1].trim()))
      continue
    }

    const pairMatch = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/)
    if (!pairMatch) continue

    flushList()
    const key = pairMatch[1]
    const rawValue = pairMatch[2].trim()
    if (!rawValue) {
      activeKey = key
      activeList = []
      continue
    }
    result[key] = parseInlineValue(rawValue)
  }

  flushList()
  return result
}

function parseInlineValue(rawValue: string): unknown {
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

function stringArrayValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
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
