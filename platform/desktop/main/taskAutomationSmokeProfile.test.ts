import { describe, expect, it, vi } from 'vitest'

import { configureTaskAutomationSmokeProfile } from './taskAutomationSmokeProfile'

describe('task automation smoke profile', () => {
  it('does not touch Electron paths or cleanup hooks outside the exact opt-in environment', () => {
    const app = { setPath: vi.fn(), once: vi.fn() }
    const createDirectory = vi.fn(() => '/tmp/task-smoke-unexpected')
    const createPlatformDirectory = vi.fn()
    const removeDirectory = vi.fn()

    const profile = configureTaskAutomationSmokeProfile({
      environment: { AI_DESKTOP_TASK_SMOKE: 'true' },
      app,
      createDirectory,
      createPlatformDirectory,
      removeDirectory,
      log: vi.fn()
    })

    expect(profile).toEqual({ enabled: false, userDataPath: null })
    expect(createDirectory).not.toHaveBeenCalled()
    expect(createPlatformDirectory).not.toHaveBeenCalled()
    expect(app.setPath).not.toHaveBeenCalled()
    expect(app.once).not.toHaveBeenCalled()
    expect(removeDirectory).not.toHaveBeenCalled()
  })

  it('redirects the exact opt-in profile to a unique disposable userData directory before stores initialize', () => {
    const app = { setPath: vi.fn(), once: vi.fn() }
    const log = vi.fn()
    const removeDirectory = vi.fn()
    const createPlatformDirectory = vi.fn()

    const profile = configureTaskAutomationSmokeProfile({
      environment: { AI_DESKTOP_TASK_SMOKE: '1' },
      app,
      createDirectory: () => '/tmp/ai-desktop-task-smoke-unique',
      createPlatformDirectory,
      removeDirectory,
      log
    })

    expect(profile).toEqual({ enabled: true, userDataPath: '/tmp/ai-desktop-task-smoke-unique' })
    expect(app.setPath).toHaveBeenCalledWith('userData', '/tmp/ai-desktop-task-smoke-unique')
    expect(createPlatformDirectory).toHaveBeenCalledWith('/tmp/ai-desktop-task-smoke-unique/platform')
    expect(app.once).toHaveBeenCalledWith('will-quit', expect.any(Function))
    expect(log).toHaveBeenCalledWith('[task-smoke] disposable userData: /tmp/ai-desktop-task-smoke-unique')

    const cleanup = app.once.mock.calls[0]?.[1] as (() => void) | undefined
    cleanup?.()
    cleanup?.()
    expect(removeDirectory).toHaveBeenCalledTimes(1)
    expect(removeDirectory).toHaveBeenCalledWith('/tmp/ai-desktop-task-smoke-unique')
  })
})
