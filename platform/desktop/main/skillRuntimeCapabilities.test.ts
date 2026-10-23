import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { InstalledSkill } from '../../ai/agent-platform/schemas/skillSchemas'
import { createSkillRuntimeCapabilityResolver, createSkillRuntimeToolsResolver } from './skillRuntimeCapabilities'

const installedSkill: InstalledSkill = {
  id: 'skill-1',
  name: 'Code Reader',
  description: 'Reads and analyzes code',
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

describe('skill runtime capabilities', () => {
  it('summarizes a skill entry file into runtime capability metadata', async () => {
    const skillsRoot = join(tmpdir(), `skill-runtime-capabilities-${Date.now()}`)
    await mkdir(skillsRoot, { recursive: true })
    await mkdir(join(skillsRoot, 'code-reader'), { recursive: true })
    await writeFile(
      join(skillsRoot, 'code-reader', 'SKILL.md'),
      [
        '---',
        'name: Code Reader',
        'description: Reads and analyzes code',
        '---',
        '',
        '# Code Reader',
        '',
        'Use this skill when inspecting unfamiliar repositories.',
        '',
        'Read package boundaries before changing files.'
      ].join('\n'),
      'utf8'
    )

    const resolveCapabilities = createSkillRuntimeCapabilityResolver({
      skillsRoot,
      maxBodyPreviewChars: 90
    })

    expect(resolveCapabilities(installedSkill)).toEqual([
      {
        capabilityId: 'skill-1:SKILL.md',
        kind: 'entry-file-summary',
        title: 'Code Reader',
        summary: 'Reads and analyzes code',
        sourcePath: 'SKILL.md',
        entryFile: 'SKILL.md',
        bodyPreview: 'Use this skill when inspecting unfamiliar repositories. Read package boundaries before...',
        bodyPreviewTruncated: true
      }
    ])
  })

  it('resolves declared skill tools from skill entry frontmatter', async () => {
    const skillsRoot = join(tmpdir(), `skill-runtime-tools-${Date.now()}`)
    await mkdir(skillsRoot, { recursive: true })
    await mkdir(join(skillsRoot, 'code-reader'), { recursive: true })
    await writeFile(
      join(skillsRoot, 'code-reader', 'SKILL.md'),
      [
        '---',
        'name: Code Reader',
        'tools:',
        '  - Read Docs',
        '  - Grep',
        '  - Read Docs',
        '---',
        '',
        'Use this skill when inspecting unfamiliar repositories.'
      ].join('\n'),
      'utf8'
    )

    const resolveTools = createSkillRuntimeToolsResolver({
      skillsRoot
    })

    expect(resolveTools(installedSkill)).toEqual(['Read Docs', 'Grep'])
  })

  it('summarizes declared supporting capability files while keeping reads inside the skill root', async () => {
    const skillsRoot = join(tmpdir(), `skill-runtime-capabilities-supporting-${Date.now()}`)
    await mkdir(skillsRoot, { recursive: true })
    await mkdir(join(skillsRoot, 'code-reader', 'references'), { recursive: true })
    await mkdir(join(skillsRoot, 'code-reader', 'notes'), { recursive: true })
    await writeFile(
      join(skillsRoot, 'code-reader', 'SKILL.md'),
      [
        '---',
        'name: Code Reader',
        'description: Reads and analyzes code',
        'capabilityFiles:',
        '  - references/usage.md',
        '  - notes/checklist.txt',
        '  - references/usage.md',
        '  - ../outside.md',
        '  - /tmp/outside.md',
        '  - scripts/run.sh',
        '  - missing.md',
        '---',
        '',
        'Entry body.'
      ].join('\n'),
      'utf8'
    )
    await writeFile(
      join(skillsRoot, 'code-reader', 'references', 'usage.md'),
      [
        '---',
        'name: Usage Guide',
        'description: How to use this skill safely',
        '---',
        '',
        '# Usage Guide',
        '',
        'Read the repository boundaries before changing files.'
      ].join('\n'),
      'utf8'
    )
    await writeFile(
      join(skillsRoot, 'code-reader', 'notes', 'checklist.txt'),
      'Check inputs before invoking tools.',
      'utf8'
    )
    await mkdir(join(skillsRoot, 'code-reader', 'scripts'), { recursive: true })
    await writeFile(join(skillsRoot, 'code-reader', 'scripts', 'run.sh'), 'echo unsafe', 'utf8')

    const resolveCapabilities = createSkillRuntimeCapabilityResolver({
      skillsRoot,
      maxBodyPreviewChars: 80
    })

    expect(resolveCapabilities(installedSkill)).toEqual([
      {
        capabilityId: 'skill-1:SKILL.md',
        kind: 'entry-file-summary',
        title: 'Code Reader',
        summary: 'Reads and analyzes code',
        sourcePath: 'SKILL.md',
        entryFile: 'SKILL.md',
        bodyPreview: 'Entry body.',
        bodyPreviewTruncated: false
      },
      {
        capabilityId: 'skill-1:references/usage.md',
        kind: 'supporting-file-summary',
        title: 'Usage Guide',
        summary: 'How to use this skill safely',
        sourcePath: 'references/usage.md',
        bodyPreview: 'Read the repository boundaries before changing files.',
        bodyPreviewTruncated: false
      },
      {
        capabilityId: 'skill-1:notes/checklist.txt',
        kind: 'supporting-file-summary',
        title: 'checklist.txt',
        summary: null,
        sourcePath: 'notes/checklist.txt',
        bodyPreview: 'Check inputs before invoking tools.',
        bodyPreviewTruncated: false
      }
    ])
  })

  it('does not read outside the configured skills root', () => {
    const resolveCapabilities = createSkillRuntimeCapabilityResolver({
      skillsRoot: join(tmpdir(), 'skills-root')
    })

    expect(resolveCapabilities({ ...installedSkill, folderName: '../outside' })).toEqual([])
  })

  it('supports lower-case skill.md entries and records non-truncated previews', async () => {
    const skillsRoot = join(tmpdir(), `skill-runtime-capabilities-lower-${Date.now()}`)
    await mkdir(skillsRoot, { recursive: true })
    await mkdir(join(skillsRoot, 'code-reader'), { recursive: true })
    await writeFile(
      join(skillsRoot, 'code-reader', 'skill.md'),
      [
        '---',
        'name: Lowercase Skill',
        'description: Uses lower-case entry file',
        '---',
        '',
        'Keep this preview short.'
      ].join('\n'),
      'utf8'
    )

    const resolveCapabilities = createSkillRuntimeCapabilityResolver({
      skillsRoot,
      maxBodyPreviewChars: 90
    })

    expect(resolveCapabilities(installedSkill)).toEqual([
      {
        capabilityId: 'skill-1:skill.md',
        kind: 'entry-file-summary',
        title: 'Lowercase Skill',
        summary: 'Uses lower-case entry file',
        sourcePath: 'skill.md',
        entryFile: 'skill.md',
        bodyPreview: 'Keep this preview short.',
        bodyPreviewTruncated: false
      }
    ])
  })
})
