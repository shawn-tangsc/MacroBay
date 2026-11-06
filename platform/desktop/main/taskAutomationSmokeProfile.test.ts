import { basename, dirname, join } from 'node:path'

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

    // 目录名是**数据**，不是路径字面量：生产代码用 `path.join` 拼平台子目录，
    // 期望值必须由同一个函数算出来，否则 Windows 上 `join` 产出反斜杠、字面量仍是斜杠。
    const disposableRoot = join('/tmp', 'ai-desktop-task-smoke-unique')
    const profile = configureTaskAutomationSmokeProfile({
      environment: { AI_DESKTOP_TASK_SMOKE: '1' },
      app,
      createDirectory: () => disposableRoot,
      createPlatformDirectory,
      removeDirectory,
      log
    })

    expect(profile).toEqual({ enabled: true, userDataPath: disposableRoot })
    expect(app.setPath).toHaveBeenCalledWith('userData', disposableRoot)
    expect(createPlatformDirectory).toHaveBeenCalledWith(join(disposableRoot, 'platform'))
    expect(app.once).toHaveBeenCalledWith('will-quit', expect.any(Function))
    expect(log).toHaveBeenCalledWith(`[task-smoke] disposable userData: ${disposableRoot}`)

    // 除了「拼出来的整串相等」，再钉一次结构：平台子目录就在可丢弃根目录下、名字是 platform。
    // 只比较整串时，两边一起改错也看不出来；dirname/basename 走的是当前平台的路径规则。
    const createdPlatformDirectory = createPlatformDirectory.mock.calls[0]?.[0] as string
    expect(dirname(createdPlatformDirectory)).toBe(disposableRoot)
    expect(basename(createdPlatformDirectory)).toBe('platform')

    const cleanup = app.once.mock.calls[0]?.[1] as (() => void) | undefined
    cleanup?.()
    cleanup?.()
    expect(removeDirectory).toHaveBeenCalledTimes(1)
    expect(removeDirectory).toHaveBeenCalledWith(disposableRoot)
  })
})
