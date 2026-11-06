import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { publishGeneratedArtifacts } from './publishArtifacts'

let root: string
let staging: string
let output: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'macrobay-publish-'))
  staging = join(root, 'staging')
  output = join(root, 'output')
  mkdirSync(staging)
  mkdirSync(output)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Milliseconds: a rewrite moves the mtime to now, which differs from the 2020 timestamp below. */
function mtimeOf(path: string): number {
  return statSync(path).mtimeMs
}

describe('publishGeneratedArtifacts', () => {
  it('leaves a byte-identical file untouched, including its mtime', () => {
    writeFileSync(join(staging, 'a.ts'), 'same\n')
    writeFileSync(join(output, 'a.ts'), 'same\n')
    // A clearly older mtime: if the file were rewritten it would move to now.
    const before = new Date('2020-01-01T00:00:00.000Z')
    utimesSync(join(output, 'a.ts'), before, before)
    const original = mtimeOf(join(output, 'a.ts'))

    const result = publishGeneratedArtifacts(staging, output, ['a.ts'])

    expect(result).toEqual({ written: [], unchanged: ['a.ts'] })
    expect(readFileSync(join(output, 'a.ts'), 'utf8')).toBe('same\n')
    expect(mtimeOf(join(output, 'a.ts'))).toBe(original)
  })

  it('writes only the artifact whose content changed', () => {
    writeFileSync(join(staging, 'a.ts'), 'changed\n')
    writeFileSync(join(output, 'a.ts'), 'old\n')
    writeFileSync(join(staging, 'b.ts'), 'same\n')
    writeFileSync(join(output, 'b.ts'), 'same\n')

    const result = publishGeneratedArtifacts(staging, output, ['a.ts', 'b.ts'])

    expect(result).toEqual({ written: ['a.ts'], unchanged: ['b.ts'] })
    expect(readFileSync(join(output, 'a.ts'), 'utf8')).toBe('changed\n')
    expect(readFileSync(join(output, 'b.ts'), 'utf8')).toBe('same\n')
  })

  it('writes a missing artifact: the first run always produces files', () => {
    writeFileSync(join(staging, 'a.ts'), 'first\n')

    expect(publishGeneratedArtifacts(staging, output, ['a.ts'])).toEqual({ written: ['a.ts'], unchanged: [] })
    expect(readFileSync(join(output, 'a.ts'), 'utf8')).toBe('first\n')
  })
})
