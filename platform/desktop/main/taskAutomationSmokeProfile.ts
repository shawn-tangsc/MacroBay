import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type ElectronAppPathControl = {
  setPath: (name: string, path: string) => void
  once: (event: 'will-quit', listener: () => void) => void
}

type Dependencies = {
  environment: NodeJS.ProcessEnv
  app: ElectronAppPathControl
  createDirectory?: () => string
  createPlatformDirectory?: (path: string) => void
  removeDirectory?: (path: string) => void
  log?: (message: string) => void
}

export type TaskAutomationSmokeProfile = {
  enabled: boolean
  userDataPath: string | null
}

export function configureTaskAutomationSmokeProfile(deps: Dependencies): TaskAutomationSmokeProfile {
  if (deps.environment.AI_DESKTOP_TASK_SMOKE !== '1') {
    return { enabled: false, userDataPath: null }
  }

  const userDataPath = (deps.createDirectory ?? createSmokeDirectory)()
  ;(deps.createPlatformDirectory ?? createSmokePlatformDirectory)(join(userDataPath, 'platform'))
  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    ;(deps.removeDirectory ?? removeSmokeDirectory)(userDataPath)
  }

  deps.app.setPath('userData', userDataPath)
  deps.app.once('will-quit', cleanup)
  ;(deps.log ?? console.log)(`[task-smoke] disposable userData: ${userDataPath}`)
  return { enabled: true, userDataPath }
}

function createSmokeDirectory(): string {
  return mkdtempSync(join(tmpdir(), 'ai-desktop-task-smoke-'))
}

function createSmokePlatformDirectory(path: string): void {
  mkdirSync(path, { recursive: true })
}

function removeSmokeDirectory(path: string): void {
  rmSync(path, { recursive: true, force: true })
}
