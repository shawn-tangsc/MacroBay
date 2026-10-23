import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { findAllSkillDirectories, parseSkillMetadata } from './skillMetadataParser'

describe('skill metadata parser', () => {
  it('parses SKILL.md frontmatter and hashes the skill file', async () => {
    const root = join(tmpdir(), 'ai-desktop-platform-tests', 'skill-parser', `skill-${Date.now()}`)
    await mkdir(root, { recursive: true })
    await writeFile(
      join(root, 'SKILL.md'),
      [
        '---',
        'name: Code Reader',
        'description: Reads source files',
        'author: Demo Author',
        'tags: code, review',
        'tools:',
        '  - Read',
        '  - Grep',
        '---',
        '',
        '# Body'
      ].join('\n'),
      'utf8'
    )

    const metadata = await parseSkillMetadata(root)

    expect(metadata).toMatchObject({
      name: 'Code Reader',
      description: 'Reads source files',
      author: 'Demo Author',
      folderName: expect.stringContaining('skill-'),
      tags: ['code', 'review'],
      tools: ['Read', 'Grep'],
      skillFilePath: join(root, 'SKILL.md')
    })
    expect(metadata.contentHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('falls back to folder name and supports lowercase skill.md', async () => {
    const root = join(tmpdir(), 'ai-desktop-platform-tests', 'skill-parser', `fallback-${Date.now()}`)
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'skill.md'), '# No frontmatter', 'utf8')

    const metadata = await parseSkillMetadata(root)

    expect(metadata.name).toBe(root.split('/').at(-1))
    expect(metadata.skillFilePath.toLowerCase()).toBe(join(root, 'skill.md').toLowerCase())
  })

  it('finds nested skill directories without descending into an existing skill folder', async () => {
    const root = join(tmpdir(), 'ai-desktop-platform-tests', 'skill-parser', `nested-${Date.now()}`)
    const first = join(root, 'one')
    const second = join(root, 'nested', 'two')
    await mkdir(first, { recursive: true })
    await mkdir(second, { recursive: true })
    await writeFile(join(first, 'SKILL.md'), '---\nname: One\n---\n', 'utf8')
    await writeFile(join(second, 'SKILL.md'), '---\nname: Two\n---\n', 'utf8')

    const directories = await findAllSkillDirectories(root, root, 4)

    expect(directories.map((item) => item.sourcePath).sort()).toEqual(['nested/two', 'one'])
  })
})
