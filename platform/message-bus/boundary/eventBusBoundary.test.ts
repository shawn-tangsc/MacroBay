import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const messageBusRoot = join(process.cwd(), 'platform/message-bus')

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) return listSourceFiles(fullPath)
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) return [fullPath]
    return []
  })
}

describe('message bus boundary', () => {
  it('does not import product implementation files', () => {
    const offenders = listSourceFiles(messageBusRoot).flatMap((filePath) => {
      const content = readFileSync(filePath, 'utf8')
      const matches = [...content.matchAll(/from ['"]products\//g)]
      return matches.map(() => filePath)
    })
    expect(offenders).toEqual([])
  })

  it('does not branch on market-intelligence payload fields', () => {
    const offenders = listSourceFiles(messageBusRoot).filter((filePath) => {
      const content = readFileSync(filePath, 'utf8').toLowerCase()
      return (
        content.includes('sentiment') ||
        content.includes('binance') ||
        content.includes('btc') ||
        content.includes('impactdirection')
      )
    })
    expect(offenders).toEqual([])
  })
})
