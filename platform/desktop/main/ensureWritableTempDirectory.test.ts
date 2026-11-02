import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ensureWritableTempDirectory } from './ensureWritableTempDirectory'

const roots: string[] = []

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'macrobay-writable-temp-'))
  roots.push(root)
  return root
}

describe('ensureWritableTempDirectory', () => {
  it('keeps the system temp directory when it accepts a probe file', () => {
    const root = createRoot()
    const environment: NodeJS.ProcessEnv = { TEMP: root, TMP: root }
    const setPath = () => {
      throw new Error('setPath must not be called when the system temp works')
    }

    const result = ensureWritableTempDirectory({
      osTempDirectory: root,
      fallbackDirectory: join(root, 'fallback'),
      environment,
      setPath
    })

    expect(result).toEqual({ directory: root, redirected: false })
    expect(environment).toEqual({ TEMP: root, TMP: root })
    expect(readdirSync(root)).toEqual([])
  })

  it('redirects TEMP and TMP to the fallback when the system temp cannot be written', () => {
    const root = createRoot()
    const blocker = join(root, 'blocker')
    writeFileSync(blocker, '')
    const fallback = join(root, 'nested', 'tmp')
    const environment: NodeJS.ProcessEnv = { TEMP: join(blocker, 'temp'), TMP: join(blocker, 'temp') }
    const paths: Array<[string, string]> = []

    const result = ensureWritableTempDirectory({
      osTempDirectory: join(blocker, 'temp'),
      fallbackDirectory: fallback,
      environment,
      setPath: (name, value) => paths.push([name, value])
    })

    expect(result.directory).toBe(fallback)
    expect(result.redirected).toBe(true)
    expect(result.osTempError).toBeTruthy()
    expect(environment.TEMP).toBe(fallback)
    expect(environment.TMP).toBe(fallback)
    expect(paths).toEqual([['temp', fallback]])
    expect(readdirSync(fallback)).toEqual([])
  })

  it('creates the fallback directory when it does not exist yet', () => {
    const root = createRoot()
    const fallback = join(root, 'does', 'not', 'exist')

    const result = ensureWritableTempDirectory({
      osTempDirectory: join(root, 'missing'),
      fallbackDirectory: fallback,
      environment: {}
    })

    expect(result.directory).toBe(fallback)
    expect(readdirSync(fallback)).toEqual([])
  })

  it('fails loudly with both reasons when neither directory can hold a temp file', () => {
    const root = createRoot()
    const blocker = join(root, 'blocker')
    writeFileSync(blocker, '')

    expect(() =>
      ensureWritableTempDirectory({
        osTempDirectory: join(blocker, 'temp'),
        fallbackDirectory: join(blocker, 'fallback'),
        environment: {}
      })
    ).toThrow(/No writable temporary directory/)
  })

  it('does not leave probe files behind in a writable directory', () => {
    const root = createRoot()
    mkdirSync(join(root, 'empty'))
    const target = join(root, 'empty')

    ensureWritableTempDirectory({
      osTempDirectory: target,
      fallbackDirectory: join(root, 'fallback'),
      environment: {}
    })

    expect(readdirSync(target)).toEqual([])
  })
})
