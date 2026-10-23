import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()
const cacheGovernanceDir = join(repoRoot, 'platform/storage/cache-governance')

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) return listSourceFiles(fullPath)
    if ((entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) && !entry.name.includes('.test.')) return [fullPath]
    return []
  })
}

describe('cache governance boundary', () => {
  it('keeps platform cache governance free of product implementation imports', () => {
    const offenders = listSourceFiles(cacheGovernanceDir).filter((filePath) => {
      const source = readFileSync(filePath, 'utf8')
      return /from ['"][^'"]*products\//.test(source) || /@products\//.test(source)
    })

    expect(offenders).toEqual([])
  })
})
