import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The standard is only worth having if the next page cannot quietly fork it. These guards read the
 * tree instead of a component, because the drift they catch is *new* code that never imported the
 * standard at all.
 */
const repoRoot = resolve(import.meta.dirname, '../../../..')
const sourceRoots = ['apps/desktop-shell/src/renderer/src', 'products', 'platform']
const standardCss = 'platform/ui/components/loading/loadingState.css'

function walk(root: string, extensions: readonly string[]): string[] {
  const found: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      found.push(...walk(path, extensions))
    } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      found.push(path)
    }
  }
  return found
}

function relative(path: string): string {
  return path.slice(repoRoot.length + 1)
}

const files = sourceRoots.flatMap((root) => walk(resolve(repoRoot, root), ['.ts', '.tsx', '.css']))
const productionFiles = files.filter((path) => !/\.test\.(ts|tsx)$/.test(path))

describe('the loading standard', () => {
  it('owns the app’s only rotation animation', () => {
    const rotating = productionFiles
      .filter((path) => path.endsWith('.css'))
      .filter((path) => /rotate\(\s*360deg\s*\)/.test(readFileSync(path, 'utf8')))
      .map(relative)

    expect(rotating).toEqual([standardCss])
  })

  it('is the only spinner glyph — no component keeps a static loader icon', () => {
    const offenders = productionFiles
      .filter((path) => path.endsWith('.tsx'))
      .filter((path) => /\b(Loader2|LoaderCircle)\b/.test(readFileSync(path, 'utf8')))
      .map(relative)

    expect(offenders).toEqual([])
  })

  it('is not bypassed by a locally animated ".spin" class', () => {
    const offenders = productionFiles
      .filter((path) => path.endsWith('.css'))
      .filter((path) => /\.spin\b/.test(readFileSync(path, 'utf8')))
      .map(relative)

    expect(offenders).toEqual([])
  })
})
