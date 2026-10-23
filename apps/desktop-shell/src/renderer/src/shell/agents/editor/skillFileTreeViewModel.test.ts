import { describe, expect, it } from 'vitest'

import type { SkillFileNode } from '@platform/ai/agent-platform/schemas/skillSchemas'

import { findFirstSkillPreviewFile, flattenSkillFileTree, guessSkillFileLanguage, isSkillMarkdownFile } from './skillFileTreeViewModel'

const tree: SkillFileNode[] = [
  {
    name: 'references',
    path: 'references',
    type: 'directory',
    children: [{ name: 'guide.md', path: 'references/guide.md', type: 'file' }]
  },
  { name: 'SKILL.md', path: 'SKILL.md', type: 'file' },
  { name: 'config.json', path: 'config.json', type: 'file' }
]

describe('skill file tree view model', () => {
  it('prefers SKILL.md as the default preview file', () => {
    expect(findFirstSkillPreviewFile(tree)).toBe('SKILL.md')
  })

  it('flattens nested files with depth and directory markers', () => {
    expect(flattenSkillFileTree(tree)).toEqual([
      { name: 'references', path: 'references', type: 'directory', depth: 0 },
      { name: 'guide.md', path: 'references/guide.md', type: 'file', depth: 1 },
      { name: 'SKILL.md', path: 'SKILL.md', type: 'file', depth: 0 },
      { name: 'config.json', path: 'config.json', type: 'file', depth: 0 }
    ])
  })

  it('detects markdown files and preview language', () => {
    expect(isSkillMarkdownFile('guide.mdx')).toBe(true)
    expect(guessSkillFileLanguage('script.ts')).toBe('typescript')
    expect(guessSkillFileLanguage('notes.unknown')).toBe('text')
  })
})
