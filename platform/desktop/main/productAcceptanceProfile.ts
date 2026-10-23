import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'

type ElectronAppPathControl = {
  setPath: (name: string, path: string) => void
  once: (event: 'will-quit', listener: () => void) => void
}

type Dependencies = {
  environment: NodeJS.ProcessEnv | Record<string, string | undefined>
  argv: readonly string[]
  app: ElectronAppPathControl
  tempRoot?: string
  removeCreatedProfileDirectory?: (path: string) => void
  log?: (message: string) => void
}

type CleanupOptions = {
  tempRoot?: string
  removeProfileDirectory?: (path: string) => void
}

export type ProductAcceptanceProfile = {
  enabled: boolean
  userDataPath: string | null
}

export const PRODUCT_ACCEPTANCE_PROFILE_MARKER = '.product-acceptance-profile'

export const PRODUCT_ACCEPTANCE_CLEANUP_GUARD_POLICY = {
  owner: 'platform/desktop/main/productAcceptanceProfile',
  source: 'ProductAcceptanceCleanupGuardPolicy',
  defaultOrLimit: 'Only profiles created and registered by this process are cleanup targets.',
  failure: 'Revoke the cleanup registration and preserve the original setup error.',
  testBoundary: 'platform/desktop/main/productAcceptanceProfile.test.ts'
} as const

const PRODUCT_ACCEPTANCE_PROFILE_ENV = 'AI_DESKTOP_PRODUCT_ACCEPTANCE'
const PRODUCT_ACCEPTANCE_PROFILE_CLI_FLAG = '--product-acceptance-profile'
const PRODUCT_ACCEPTANCE_PROFILE_PREFIX = 'ai-desktop-product-acceptance-'
const registeredCleanupTargets = new Set<string>()

export function resolveProductAcceptanceProfileOptIn(input: {
  environment: NodeJS.ProcessEnv | Record<string, string | undefined>
  argv: readonly string[]
}): boolean {
  return input.environment[PRODUCT_ACCEPTANCE_PROFILE_ENV] === '1' || input.argv.includes(PRODUCT_ACCEPTANCE_PROFILE_CLI_FLAG)
}

export function configureProductAcceptanceProfile(deps: Dependencies): ProductAcceptanceProfile {
  if (!resolveProductAcceptanceProfileOptIn({ environment: deps.environment, argv: deps.argv })) {
    return { enabled: false, userDataPath: null }
  }

  const tempRoot = deps.tempRoot ?? tmpdir()
  const userDataPath = createProductAcceptanceProfileDirectory(tempRoot)
  const resolvedUserDataPath = resolve(userDataPath)
  let registered = false

  try {
    mkdirSync(join(userDataPath, 'platform'), { recursive: true })
    writeFileSync(
      join(userDataPath, PRODUCT_ACCEPTANCE_PROFILE_MARKER),
      `${PRODUCT_ACCEPTANCE_CLEANUP_GUARD_POLICY.source}\n`,
      'utf8'
    )

    registeredCleanupTargets.add(resolvedUserDataPath)
    registered = true
    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      cleanupProductAcceptanceProfile(userDataPath, { tempRoot })
    }

    deps.app.setPath('userData', userDataPath)
    deps.app.once('will-quit', cleanup)
    ;(deps.log ?? console.log)(`[product-acceptance] disposable userData profile: ${basename(userDataPath)}`)
    return { enabled: true, userDataPath }
  } catch (error) {
    try {
      ;(deps.removeCreatedProfileDirectory ?? removeCreatedProfileDirectory)(resolvedUserDataPath)
    } catch {
      // The original setup error remains the only externally observable failure.
    } finally {
      if (registered) registeredCleanupTargets.delete(resolvedUserDataPath)
    }
    throw error
  }
}

export function cleanupProductAcceptanceProfile(path: string, options: CleanupOptions = {}): boolean {
  const resolvedPath = resolve(path)
  if (!registeredCleanupTargets.has(resolvedPath) || !isProductAcceptanceCleanupTarget(resolvedPath, options.tempRoot ?? tmpdir())) {
    return false
  }

  try {
    ;(options.removeProfileDirectory ?? removeCreatedProfileDirectory)(resolvedPath)
    return true
  } finally {
    registeredCleanupTargets.delete(resolvedPath)
  }
}

function createProductAcceptanceProfileDirectory(tempRoot: string): string {
  return mkdtempSync(join(tempRoot, PRODUCT_ACCEPTANCE_PROFILE_PREFIX))
}

function removeCreatedProfileDirectory(path: string): void {
  rmSync(path, { recursive: true, force: true })
}

function isProductAcceptanceCleanupTarget(path: string, tempRoot: string): boolean {
  if (!isProductAcceptanceProfilePath(path, tempRoot)) return false

  const markerPath = join(resolve(path), PRODUCT_ACCEPTANCE_PROFILE_MARKER)
  if (!existsSync(markerPath)) return false
  try {
    return readFileSync(markerPath, 'utf8').includes(PRODUCT_ACCEPTANCE_CLEANUP_GUARD_POLICY.source)
  } catch {
    return false
  }
}

function isProductAcceptanceProfilePath(path: string, tempRoot: string): boolean {
  const resolvedPath = resolve(path)
  const resolvedTempRoot = resolve(tempRoot)
  const relativePath = relative(resolvedTempRoot, resolvedPath)
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) return false
  if (!basename(resolvedPath).startsWith(PRODUCT_ACCEPTANCE_PROFILE_PREFIX)) return false
  return true
}
