import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { filesWithUnstagedChanges } from './pre-commit-unstaged.mts'

/**
 * 「要提交的文件同时还有未暂存改动」这条警示的判据。
 *
 * 场景照 2026-11-10 那次事故：一个文件里两段改动，只 `git add` 了其中一段，然后按路径提交——
 * `git commit -- <路径>` 按工作区当前内容提交，没暂存的那段跟着进了 HEAD。
 * 这条**只警告不拦截**，所以用例只断言「报不报、报哪个文件」。
 */

const temporary: string[] = []
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  temporary.push(dir)
  return dir
}

afterEach(() => {
  while (temporary.length > 0) rmSync(temporary.pop() as string, { recursive: true, force: true })
})

function repository(file = 'note.ts'): { cwd: string; path: string } {
  const cwd = tempDir('pre-commit-unstaged-')
  execFileSync('git', ['init', '--quiet'], { cwd })
  execFileSync('git', ['config', 'user.email', 'test@example.test'], { cwd })
  execFileSync('git', ['config', 'user.name', 'test'], { cwd })
  writeFileSync(join(cwd, file), 'export const note = 1\n')
  execFileSync('git', ['add', '--all'], { cwd })
  execFileSync('git', ['commit', '--quiet', '-m', 'base'], { cwd })
  return { cwd, path: file }
}

describe('unstaged drift on the files being committed', () => {
  it('reports a file whose later hunk is not staged', () => {
    const { cwd, path } = repository()
    // 第一段：写进暂存区。
    writeFileSync(join(cwd, path), 'export const note = 1\nexport const first = 2\n')
    execFileSync('git', ['add', '--', path], { cwd })
    // 第二段：只留在工作区。
    writeFileSync(join(cwd, path), 'export const note = 1\nexport const first = 2\nexport const second = 3\n')

    expect(filesWithUnstagedChanges({ cwd, staged: [path] })).toEqual([path])
  })

  it('stays quiet when everything in the file is staged', () => {
    const { cwd, path } = repository()
    writeFileSync(join(cwd, path), 'export const note = 1\nexport const first = 2\n')
    execFileSync('git', ['add', '--', path], { cwd })

    expect(filesWithUnstagedChanges({ cwd, staged: [path] })).toEqual([])
  })

  it('ignores unstaged changes in files that are not part of the commit', () => {
    const { cwd, path } = repository()
    writeFileSync(join(cwd, path), 'export const note = 1\nexport const staged = 2\n')
    execFileSync('git', ['add', '--', path], { cwd })
    writeFileSync(join(cwd, 'other.ts'), 'export const other = 1\n')
    writeFileSync(join(cwd, 'other.ts'), 'export const other = 2\n')

    expect(filesWithUnstagedChanges({ cwd, staged: [path] })).toEqual([])
  })

  it('says nothing when there is nothing being committed', () => {
    const { cwd } = repository()

    expect(filesWithUnstagedChanges({ cwd, staged: [] })).toEqual([])
  })

  it('keeps the order of the committed files', () => {
    const { cwd } = repository()
    for (const name of ['b.ts', 'a.ts']) writeFileSync(join(cwd, name), 'export const value = 1\n')
    execFileSync('git', ['add', '--all'], { cwd })
    for (const name of ['b.ts', 'a.ts']) writeFileSync(join(cwd, name), 'export const value = 2\n')

    expect(filesWithUnstagedChanges({ cwd, staged: ['b.ts', 'a.ts'] })).toEqual(['b.ts', 'a.ts'])
  })
})
