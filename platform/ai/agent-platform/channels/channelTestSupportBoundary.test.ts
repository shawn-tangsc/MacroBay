import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * `channelTestSupport.ts` writes `channel_adapter_support = 'supported'` directly, bypassing the
 * evidence ledger. That is correct for a test fixture and catastrophic in production: it is exactly
 * the "turn the gate into theater" case the acceptance design forbids. Only tests may import it.
 */

const repoRoot = process.cwd()
const sourceRoots = ['platform', join('apps', 'desktop-shell', 'src'), 'products']

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) return listSourceFiles(fullPath)
    if (!/\.(ts|tsx)$/.test(entry.name)) return []
    return [fullPath]
  })
}

describe('channel test support boundary', () => {
  it('is imported only by test files', () => {
    const offenders = sourceRoots.flatMap((root) =>
      listSourceFiles(join(repoRoot, root)).flatMap((filePath) => {
        const relative = filePath.slice(repoRoot.length + 1)
        if (relative.endsWith('.test.ts') || relative.endsWith('.test.tsx')) return []
        if (relative.endsWith(join('channels', 'channelTestSupport.ts'))) return []
        const content = readFileSync(filePath, 'utf8')
        return content.includes('channelTestSupport') ? [relative] : []
      })
    )

    expect(offenders).toEqual([])
  })
})
