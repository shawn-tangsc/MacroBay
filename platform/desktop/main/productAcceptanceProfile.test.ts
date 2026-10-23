import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  PRODUCT_ACCEPTANCE_PROFILE_MARKER,
  cleanupProductAcceptanceProfile,
  configureProductAcceptanceProfile,
  resolveProductAcceptanceProfileOptIn
} from './productAcceptanceProfile'

const createdRoots: string[] = []

afterEach(() => {
  for (const root of createdRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('product acceptance profile', () => {
  it('does not touch Electron paths, directories, or cleanup hooks for non-exact opt-in values', async () => {
    const app = { setPath: vi.fn(), once: vi.fn() }

    const values = [
      {},
      { AI_DESKTOP_PRODUCT_ACCEPTANCE: 'true' },
      { AI_DESKTOP_PRODUCT_ACCEPTANCE: 'yes' },
      { AI_DESKTOP_PRODUCT_ACCEPTANCE: ' 1' },
      { AI_DESKTOP_PRODUCT_ACCEPTANCE: '1 ' }
    ]

    for (const environment of values) {
      const profile = await configureProductAcceptanceProfile({
        environment,
        argv: [],
        app,
        log: vi.fn()
      })

      expect(profile).toEqual({ enabled: false, userDataPath: null })
    }

    expect(app.setPath).not.toHaveBeenCalled()
    expect(app.once).not.toHaveBeenCalled()
  })

  it('creates a unique marked temp profile with a platform directory and cleanup hook for exact opt-in', async () => {
    const root = mkdtempSync(join(tmpdir(), 'product-acceptance-test-root-'))
    createdRoots.push(root)
    const app = { setPath: vi.fn(), once: vi.fn() }
    const log = vi.fn()

    const first = await configureProductAcceptanceProfile({
      environment: { AI_DESKTOP_PRODUCT_ACCEPTANCE: '1' },
      argv: [],
      app,
      tempRoot: root,
      log
    })
    const second = await configureProductAcceptanceProfile({
      environment: {},
      argv: ['--product-acceptance-profile'],
      app,
      tempRoot: root,
      log
    })

    expect(first.enabled).toBe(true)
    expect(second.enabled).toBe(true)
    expect(first.userDataPath).toMatch(/^\/.*ai-desktop-product-acceptance-/)
    expect(second.userDataPath).toMatch(/^\/.*ai-desktop-product-acceptance-/)
    expect(first.userDataPath).not.toBe(second.userDataPath)

    for (const profile of [first, second]) {
      expect(profile.userDataPath).toBeTruthy()
      expect(existsSync(join(profile.userDataPath!, 'platform'))).toBe(true)
      await expect(readFile(join(profile.userDataPath!, PRODUCT_ACCEPTANCE_PROFILE_MARKER), 'utf8')).resolves.toContain(
        'ProductAcceptanceCleanupGuardPolicy'
      )
    }

    expect(app.setPath).toHaveBeenCalledWith('userData', first.userDataPath)
    expect(app.setPath).toHaveBeenCalledWith('userData', second.userDataPath)
    expect(app.once).toHaveBeenCalledWith('will-quit', expect.any(Function))
    expect(log).toHaveBeenCalledWith(
      `[product-acceptance] disposable userData profile: ${path.basename(first.userDataPath!)}`
    )
    expect(log.mock.calls.flat().join('\n')).not.toContain(first.userDataPath!)
  })

  it('cleans only the marked temporary profile registered by this process', async () => {
    const root = mkdtempSync(join(tmpdir(), 'product-acceptance-cleanup-root-'))
    createdRoots.push(root)
    const externallyMarked = mkdtempSync(join(root, 'ai-desktop-product-acceptance-'))
    const unmarked = mkdtempSync(join(root, 'ai-desktop-product-acceptance-'))
    const outsideTemp = mkdtempSync(join(process.cwd(), 'ai-desktop-product-acceptance-non-temp-'))
    createdRoots.push(outsideTemp)
    const app = { setPath: vi.fn(), once: vi.fn() }
    await writeFile(join(externallyMarked, PRODUCT_ACCEPTANCE_PROFILE_MARKER), 'ProductAcceptanceCleanupGuardPolicy\n', 'utf8')
    await writeFile(join(outsideTemp, PRODUCT_ACCEPTANCE_PROFILE_MARKER), 'ProductAcceptanceCleanupGuardPolicy\n', 'utf8')
    const profile = configureProductAcceptanceProfile({
      environment: { AI_DESKTOP_PRODUCT_ACCEPTANCE: '1' },
      argv: [],
      app,
      tempRoot: root,
      log: vi.fn()
    })
    const registeredCleanup = app.once.mock.calls.find(([event]) => event === 'will-quit')?.[1] as (() => void) | undefined

    expect(cleanupProductAcceptanceProfile(externallyMarked, { tempRoot: root })).toBe(false)
    expect(cleanupProductAcceptanceProfile(unmarked, { tempRoot: root })).toBe(false)
    expect(cleanupProductAcceptanceProfile(outsideTemp, { tempRoot: root })).toBe(false)

    expect(existsSync(externallyMarked)).toBe(true)
    expect(existsSync(unmarked)).toBe(true)
    expect(existsSync(outsideTemp)).toBe(true)
    expect(registeredCleanup).toBeTypeOf('function')

    registeredCleanup?.()
    registeredCleanup?.()

    expect(existsSync(profile.userDataPath!)).toBe(false)
  })

  it('ignores an arbitrary directory factory and never registers an existing marked profile for cleanup', async () => {
    const root = mkdtempSync(join(tmpdir(), 'product-acceptance-factory-root-'))
    createdRoots.push(root)
    const externallyMarked = mkdtempSync(join(root, 'ai-desktop-product-acceptance-'))
    const app = { setPath: vi.fn(), once: vi.fn() }
    await writeFile(join(externallyMarked, PRODUCT_ACCEPTANCE_PROFILE_MARKER), 'ProductAcceptanceCleanupGuardPolicy\n', 'utf8')

    const profile = configureProductAcceptanceProfile({
      environment: { AI_DESKTOP_PRODUCT_ACCEPTANCE: '1' },
      argv: [],
      app,
      tempRoot: root,
      log: vi.fn(),
      // This legacy runtime property must not influence manager-owned creation.
      createProfileDirectory: () => externallyMarked
    } as unknown as Parameters<typeof configureProductAcceptanceProfile>[0])

    expect(profile.userDataPath).not.toBe(externallyMarked)
    expect(cleanupProductAcceptanceProfile(externallyMarked, { tempRoot: root })).toBe(false)
    expect(existsSync(externallyMarked)).toBe(true)
  })

  it('removes and revokes a created profile when setting userData fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'product-acceptance-set-path-failure-root-'))
    createdRoots.push(root)
    const app = {
      setPath: vi.fn(() => {
        throw new Error('set-path-fixture-failure')
      }),
      once: vi.fn()
    }

    expect(() =>
      configureProductAcceptanceProfile({
        environment: { AI_DESKTOP_PRODUCT_ACCEPTANCE: '1' },
        argv: [],
        app,
        tempRoot: root,
        log: vi.fn()
      })
    ).toThrow('set-path-fixture-failure')

    const createdProfile = (app.setPath.mock.calls as unknown as Array<[string, string]>)[0]?.[1] ?? ''
    expect(existsSync(createdProfile)).toBe(false)
    expect(cleanupProductAcceptanceProfile(createdProfile, { tempRoot: root })).toBe(false)
    expect(app.once).not.toHaveBeenCalled()
  })

  it('preserves the cleanup-hook failure and revokes registration even when removal fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'product-acceptance-once-failure-root-'))
    createdRoots.push(root)
    const app = {
      setPath: vi.fn(),
      once: vi.fn(() => {
        throw new Error('once-fixture-failure')
      })
    }
    expect(() =>
      configureProductAcceptanceProfile({
        environment: { AI_DESKTOP_PRODUCT_ACCEPTANCE: '1' },
        argv: [],
        app,
        tempRoot: root,
        removeCreatedProfileDirectory: () => {
          throw new Error('remove-fixture-failure')
        },
        log: vi.fn()
      })
    ).toThrow('once-fixture-failure')

    const createdProfile = (app.setPath.mock.calls as unknown as Array<[string, string]>)[0]?.[1] ?? ''
    expect(existsSync(createdProfile)).toBe(true)
    expect(cleanupProductAcceptanceProfile(createdProfile, { tempRoot: root })).toBe(false)
  })

  it('revokes normal cleanup capability even when profile removal fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'product-acceptance-cleanup-failure-root-'))
    createdRoots.push(root)
    const app = { setPath: vi.fn(), once: vi.fn() }
    const profile = configureProductAcceptanceProfile({
      environment: { AI_DESKTOP_PRODUCT_ACCEPTANCE: '1' },
      argv: [],
      app,
      tempRoot: root,
      log: vi.fn()
    })

    expect(() =>
      cleanupProductAcceptanceProfile(profile.userDataPath!, {
        tempRoot: root,
        removeProfileDirectory: () => {
          throw new Error('normal-cleanup-remove-fixture-failure')
        }
      })
    ).toThrow('normal-cleanup-remove-fixture-failure')
    expect(existsSync(profile.userDataPath!)).toBe(true)
    expect(cleanupProductAcceptanceProfile(profile.userDataPath!, { tempRoot: root })).toBe(false)
  })

  it('refuses cleanup when the marker is hidden inside a nested non-profile path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'product-acceptance-nested-root-'))
    createdRoots.push(root)
    const parent = mkdtempSync(join(root, 'not-product-acceptance-'))
    await mkdir(join(parent, 'nested'), { recursive: true })
    await writeFile(join(parent, 'nested', PRODUCT_ACCEPTANCE_PROFILE_MARKER), 'ProductAcceptanceCleanupGuardPolicy\n', 'utf8')

    expect(cleanupProductAcceptanceProfile(parent, { tempRoot: root })).toBe(false)
    expect(existsSync(parent)).toBe(true)
  })

  it('uses platform path absolute checks when rejecting cleanup outside the temp root', () => {
    expect(path.isAbsolute(path.relative('/tmp/root', '/other/ai-desktop-product-acceptance-x'))).toBe(false)
    expect(cleanupProductAcceptanceProfile('/other/ai-desktop-product-acceptance-x', { tempRoot: '/tmp/root' })).toBe(false)
  })

  it('accepts only exact environment or CLI opt-in', () => {
    expect(resolveProductAcceptanceProfileOptIn({ environment: {}, argv: [] })).toBe(false)
    expect(resolveProductAcceptanceProfileOptIn({ environment: { AI_DESKTOP_PRODUCT_ACCEPTANCE: '1' }, argv: [] })).toBe(true)
    expect(resolveProductAcceptanceProfileOptIn({ environment: {}, argv: ['--product-acceptance-profile'] })).toBe(true)
    expect(resolveProductAcceptanceProfileOptIn({ environment: { AI_DESKTOP_PRODUCT_ACCEPTANCE: 'true' }, argv: [] })).toBe(false)
    expect(resolveProductAcceptanceProfileOptIn({ environment: {}, argv: ['--product-acceptance-profile=true'] })).toBe(false)
  })
})
