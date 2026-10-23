import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SkillInstaller } from './skillInstaller'

describe('skill installer', () => {
  it('copies a skill directory and computes the SKILL.md content hash', async () => {
    const root = join(tmpdir(), 'ai-desktop-platform-tests', 'skill-installer', `copy-${Date.now()}`)
    const source = join(root, 'source')
    const dest = join(root, 'dest')
    await mkdir(join(source, 'references'), { recursive: true })
    await writeFile(join(source, 'SKILL.md'), '---\nname: Copy Skill\n---\n', 'utf8')
    await writeFile(join(source, 'references', 'guide.md'), 'Guide', 'utf8')

    const installer = new SkillInstaller()
    await installer.install(source, dest)

    expect(await readFile(join(dest, 'SKILL.md'), 'utf8')).toContain('Copy Skill')
    expect(await readFile(join(dest, 'references', 'guide.md'), 'utf8')).toBe('Guide')
    await expect(installer.computeContentHash(dest)).resolves.toMatch(/^[a-f0-9]{64}$/)
  })

  it('replaces existing destination atomically enough to remove stale files', async () => {
    const root = join(tmpdir(), 'ai-desktop-platform-tests', 'skill-installer', `replace-${Date.now()}`)
    const source = join(root, 'source')
    const dest = join(root, 'dest')
    await mkdir(source, { recursive: true })
    await mkdir(dest, { recursive: true })
    await writeFile(join(source, 'SKILL.md'), '---\nname: New Skill\n---\n', 'utf8')
    await writeFile(join(dest, 'old.txt'), 'stale', 'utf8')

    const installer = new SkillInstaller()
    await installer.install(source, dest)

    await expect(readFile(join(dest, 'old.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(dest, 'SKILL.md'), 'utf8')).toContain('New Skill')
  })
})
