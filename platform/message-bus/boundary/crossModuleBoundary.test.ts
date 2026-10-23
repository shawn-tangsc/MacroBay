import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) return listSourceFiles(fullPath)
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) return [fullPath]
    return []
  })
}

describe('cross-module boundary', () => {
  it('keeps platform message bus and notifications free of product imports', () => {
    const offenders = ['platform/message-bus', 'platform/notifications'].flatMap((dir) =>
      listSourceFiles(join(repoRoot, dir)).flatMap((filePath) => {
        const content = readFileSync(filePath, 'utf8')
        return [...content.matchAll(/from ['"]products\//g)].map(() => filePath)
      })
    )
    expect(offenders).toEqual([])
  })

  it('keeps products from importing another product service internals', () => {
    const productsRoot = join(repoRoot, 'products')
    const products = readdirSync(productsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => existsSync(join(productsRoot, name, 'product.manifest.ts')))

    const offenders = products.flatMap((productId) => {
      const serviceDir = join(productsRoot, productId, 'service')
      if (!existsSync(serviceDir)) return []
      return listSourceFiles(serviceDir).flatMap((filePath) => {
        const content = readFileSync(filePath, 'utf8')
        return products
          .filter((other) => other !== productId)
          .filter((other) => content.includes(`products/${other}/service`))
          .map((other) => `${filePath} -> ${other}/service`)
      })
    })

    expect(offenders).toEqual([])
  })

  it('keeps platform core modules free of product imports', () => {
    const platformDirs = ['platform/ai', 'platform/desktop', 'platform/network', 'platform/ui']
    const allowed = /platform\/product-registry\//
    const offenders: string[] = []

    for (const dir of platformDirs) {
      const files = listSourceFiles(join(repoRoot, dir))
      for (const file of files) {
        const content = readFileSync(file, 'utf8')
        if (/from ['"][^'"]*products\//.test(content) && !allowed.test(file)) {
          offenders.push(file)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('keeps platform Web Search free of product imports and driver barrel exports', () => {
    const webSearchDir = join(repoRoot, 'platform/ai/web-search')
    const offenders = listSourceFiles(webSearchDir).filter((filePath) => {
      const content = readFileSync(filePath, 'utf8')
      return /from ['"][^'"]*products\//.test(content) || /@products\//.test(content)
    })
    const publicBarrel = readFileSync(join(webSearchDir, 'index.ts'), 'utf8')

    expect(offenders).toEqual([])
    expect(publicBarrel).not.toContain('/drivers/')
    expect(publicBarrel).not.toContain('WebSearchProviderDriver')
    expect(publicBarrel).not.toContain('WebSearchCredentialStore')
  })
})
