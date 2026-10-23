import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { InstalledSkill } from '../../ai/agent-platform/schemas/skillSchemas'
import { createSkillRuntimeToolHost } from './skillRuntimeToolHost'

const skill: InstalledSkill = {
  id: 'skill-1',
  name: 'Code Reader',
  description: 'Reads docs',
  folderName: 'code-reader',
  source: 'local',
  sourceUrl: null,
  namespace: null,
  author: null,
  sourceTags: ['code'],
  contentHash: 'hash-1',
  isEnabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

describe('skill runtime tool host', () => {
  it('returns a generic skill invocation summary with capability hints and input', async () => {
    const invokeSkillTool = createSkillRuntimeToolHost({
      resolveCapabilities: () => [
        {
          capabilityId: 'skill-1:SKILL.md',
          kind: 'entry-file-summary',
          title: 'Code Reader',
          summary: 'Use this skill when inspecting code.',
          sourcePath: 'SKILL.md',
          entryFile: 'SKILL.md',
          bodyPreview: 'Read package boundaries before changing files.',
          bodyPreviewTruncated: false
        }
      ]
    })

    await expect(
      invokeSkillTool({
        agentId: 'agent-1',
        sessionId: 'session-1',
        skill,
        toolId: 'skill__code-reader__read-docs',
        toolName: 'Read Docs',
        input: { path: 'README.md' }
      })
    ).resolves.toEqual({
      output: 'Skill "Code Reader" invoked tool "Read Docs".',
      structuredContent: {
        skillId: 'skill-1',
        skillName: 'Code Reader',
        toolId: 'skill__code-reader__read-docs',
        toolName: 'Read Docs',
        input: { path: 'README.md' },
        capabilities: [
          {
            title: 'Code Reader',
            summary: 'Use this skill when inspecting code.',
            sourcePath: 'SKILL.md',
            bodyPreview: 'Read package boundaries before changing files.',
            bodyPreviewTruncated: false
          }
        ]
      }
    })
  })

  it('reads requested skill-local text files into structured skill tool output', async () => {
    const skillsRoot = join(tmpdir(), `skill-runtime-tool-host-${Date.now()}`)
    await mkdir(join(skillsRoot, 'code-reader', 'references'), { recursive: true })
    await writeFile(
      join(skillsRoot, 'code-reader', 'references', 'usage.md'),
      'Read package boundaries before changing files.',
      'utf8'
    )

    const invokeSkillTool = createSkillRuntimeToolHost({
      skillsRoot,
      maxFileContentChars: 24,
      resolveCapabilities: () => []
    })

    await expect(
      invokeSkillTool({
        agentId: 'agent-1',
        skill,
        toolId: 'skill__code-reader__read-docs',
        toolName: 'Read Docs',
        input: { path: 'references/usage.md' }
      })
    ).resolves.toEqual({
      output: 'Read package boundaries...',
      structuredContent: {
        skillId: 'skill-1',
        skillName: 'Code Reader',
        toolId: 'skill__code-reader__read-docs',
        toolName: 'Read Docs',
        input: { path: 'references/usage.md' },
        capabilities: [],
        file: {
          path: 'references/usage.md',
          content: 'Read package boundaries...',
          truncated: true
        }
      }
    })
  })

  it('rejects skill file path traversal before reading files', async () => {
    const skillsRoot = join(tmpdir(), `skill-runtime-tool-host-traversal-${Date.now()}`)
    await mkdir(join(skillsRoot, 'code-reader'), { recursive: true })
    const invokeSkillTool = createSkillRuntimeToolHost({
      skillsRoot,
      resolveCapabilities: () => []
    })

    await expect(
      invokeSkillTool({
        agentId: 'agent-1',
        skill,
        toolId: 'skill__code-reader__read-docs',
        toolName: 'Read Docs',
        input: { path: '../outside.md' }
      })
    ).resolves.toMatchObject({
      output: 'Skill "Code Reader" could not read "../outside.md": path is outside the skill directory.',
      isError: true,
      structuredContent: {
        skillId: 'skill-1',
        toolId: 'skill__code-reader__read-docs',
        toolName: 'Read Docs',
        error: {
          code: 'path-outside-skill'
        }
      }
    })
  })

  it('returns a cancelled result when the invocation signal is already aborted', async () => {
    const abortController = new AbortController()
    abortController.abort()
    const invokeSkillTool = createSkillRuntimeToolHost({
      resolveCapabilities: () => []
    })

    await expect(
      invokeSkillTool({
        agentId: 'agent-1',
        skill,
        toolId: 'skill__code-reader__read-docs',
        toolName: 'Read Docs',
        signal: abortController.signal
      })
    ).resolves.toMatchObject({
      output: 'Skill "Code Reader" tool "Read Docs" was cancelled.',
      isError: true,
      structuredContent: {
        skillId: 'skill-1',
        toolId: 'skill__code-reader__read-docs',
        toolName: 'Read Docs',
        cancelled: true
      }
    })
  })
})
