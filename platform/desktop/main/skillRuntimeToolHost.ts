import { readFileSync, statSync } from 'node:fs'
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path'

import type {
  AgentSkillRuntimeCapability,
  AgentSkillRuntimeToolInvokeHostInput,
  AgentSkillRuntimeToolInvokeResult
} from '../../ai/agent-platform/skills'
import type { InstalledSkill } from '../../ai/agent-platform/schemas/skillSchemas'

export type SkillRuntimeToolHostOptions = {
  resolveCapabilities: (skill: InstalledSkill) => AgentSkillRuntimeCapability[]
  skillsRoot?: string
  maxFileContentChars?: number
}

const defaultMaxFileContentChars = 12_000
const readableSkillFileExtensions = new Set(['.md', '.markdown', '.mdx', '.txt'])

export function createSkillRuntimeToolHost(
  options: SkillRuntimeToolHostOptions
): (input: AgentSkillRuntimeToolInvokeHostInput) => Promise<AgentSkillRuntimeToolInvokeResult> {
  const skillsRoot = options.skillsRoot ? resolve(options.skillsRoot) : null
  const maxFileContentChars = options.maxFileContentChars ?? defaultMaxFileContentChars

  return async (input) => {
    const baseStructuredContent = createBaseStructuredContent(input, options.resolveCapabilities(input.skill))
    if (input.signal?.aborted) {
      return {
        output: `Skill "${input.skill.name}" tool "${input.toolName}" was cancelled.`,
        isError: true,
        structuredContent: {
          ...baseStructuredContent,
          cancelled: true
        }
      }
    }

    const requestedPath = extractRequestedFilePath(input.input)
    if (skillsRoot && requestedPath) {
      return readRequestedSkillFile({
        input,
        skillsRoot,
        requestedPath,
        maxFileContentChars,
        baseStructuredContent
      })
    }

    return {
      output: `Skill "${input.skill.name}" invoked tool "${input.toolName}".`,
      structuredContent: baseStructuredContent
    }
  }
}

function createBaseStructuredContent(
  input: AgentSkillRuntimeToolInvokeHostInput,
  capabilitiesInput: AgentSkillRuntimeCapability[]
): Record<string, unknown> {
  const capabilities = capabilitiesInput.map((capability) => ({
    title: capability.title,
    summary: capability.summary,
    sourcePath: capability.sourcePath,
    bodyPreview: capability.bodyPreview,
    bodyPreviewTruncated: capability.bodyPreviewTruncated
  }))

  return {
    skillId: input.skill.id,
    skillName: input.skill.name,
    toolId: input.toolId,
    toolName: input.toolName,
    input: input.input,
    capabilities
  }
}

function readRequestedSkillFile(input: {
  input: AgentSkillRuntimeToolInvokeHostInput
  skillsRoot: string
  requestedPath: string
  maxFileContentChars: number
  baseStructuredContent: Record<string, unknown>
}): AgentSkillRuntimeToolInvokeResult {
  const skillRoot = resolve(input.skillsRoot, input.input.skill.folderName)
  if (!isPathInside(skillRoot, input.skillsRoot)) {
    return createFileErrorResult(input.input, input.baseStructuredContent, input.requestedPath, {
      code: 'path-outside-skill',
      message: 'path is outside the skill directory.'
    })
  }
  if (isAbsolute(input.requestedPath)) {
    return createFileErrorResult(input.input, input.baseStructuredContent, input.requestedPath, {
      code: 'path-outside-skill',
      message: 'path is outside the skill directory.'
    })
  }

  const filePath = resolve(skillRoot, input.requestedPath)
  if (!isPathInside(filePath, skillRoot)) {
    return createFileErrorResult(input.input, input.baseStructuredContent, input.requestedPath, {
      code: 'path-outside-skill',
      message: 'path is outside the skill directory.'
    })
  }
  if (!readableSkillFileExtensions.has(extname(filePath).toLowerCase())) {
    return createFileErrorResult(input.input, input.baseStructuredContent, input.requestedPath, {
      code: 'unsupported-file-type',
      message: 'unsupported skill file type.'
    })
  }

  try {
    const info = statSync(filePath)
    if (!info.isFile()) {
      return createFileErrorResult(input.input, input.baseStructuredContent, input.requestedPath, {
        code: 'not-a-file',
        message: 'path is not a file.'
      })
    }

    const rawContent = readFileSync(filePath, 'utf8')
    const content = truncateText(rawContent, input.maxFileContentChars)
    const sourcePath = toPosixPath(relative(skillRoot, filePath)) || basename(filePath)
    return {
      output: content.text,
      structuredContent: {
        ...input.baseStructuredContent,
        file: {
          path: sourcePath,
          content: content.text,
          truncated: content.truncated
        }
      }
    }
  } catch {
    return createFileErrorResult(input.input, input.baseStructuredContent, input.requestedPath, {
      code: 'file-not-readable',
      message: 'file could not be read.'
    })
  }
}

function createFileErrorResult(
  input: AgentSkillRuntimeToolInvokeHostInput,
  baseStructuredContent: Record<string, unknown>,
  requestedPath: string,
  error: { code: string; message: string }
): AgentSkillRuntimeToolInvokeResult {
  return {
    output: `Skill "${input.skill.name}" could not read "${requestedPath}": ${error.message}`,
    isError: true,
    structuredContent: {
      ...baseStructuredContent,
      error
    }
  }
}

function extractRequestedFilePath(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const record = input as Record<string, unknown>
  for (const key of ['path', 'filePath', 'sourcePath']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return null
}

function truncateText(value: string, maxChars: number): { text: string; truncated: boolean } {
  const cleaned = value.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= maxChars) return { text: cleaned, truncated: false }
  const rawSlice = cleaned.slice(0, Math.max(0, maxChars)).trimEnd()
  const shouldTrimPartialWord =
    rawSlice.length > 0 &&
    !/\s/.test(cleaned[Math.max(0, maxChars - 1)] ?? '') &&
    !/\s/.test(cleaned[maxChars] ?? '')
  const lastWhitespace = shouldTrimPartialWord ? rawSlice.lastIndexOf(' ') : -1
  const text = lastWhitespace > 0 ? rawSlice.slice(0, lastWhitespace) : rawSlice
  return {
    text: `${text}...`,
    truncated: true
  }
}

function isPathInside(candidate: string, parent: string): boolean {
  const relativePath = relative(parent, candidate)
  return relativePath === '' || (!relativePath.startsWith('..') && !relativePath.startsWith(sep))
}

function toPosixPath(value: string): string {
  return value.split(sep).join('/')
}
