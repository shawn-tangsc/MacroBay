import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { IpcChannels } from '../../ipc/channels'

import { composeUpdateCheck, updateCheckModeFor, type UpdateCheckCompositionPorts } from './updateCheck'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

type Listener = (...args: unknown[]) => unknown
type IpcMainPort = UpdateCheckCompositionPorts['ipcMain']

function recorder(): {
  channels: string[]
  listeners: Map<string, Listener>
  ipcMain: IpcMainPort
} {
  const channels: string[] = []
  const listeners = new Map<string, Listener>()
  return {
    channels,
    listeners,
    ipcMain: {
      handle: (channel, listener) => {
        // 真实 ipcMain 对同名通道抛错；recorder 也要抛，否则重复注册会被静默吞掉。
        if (channels.includes(channel)) throw new Error(`duplicate channel: ${channel}`)
        channels.push(channel)
        listeners.set(channel, listener as unknown as Listener)
      }
    }
  }
}

function ports(input: {
  mode: 'packaged' | 'development'
  directory: string
  fetchSpy: typeof fetch
  ipcMain: IpcMainPort
}) {
  return {
    ipcMain: input.ipcMain,
    mode: input.mode,
    currentVersion: '0.3.1',
    platform: 'darwin',
    stateFilePath: join(input.directory, 'state.json'),
    releaseNotesFilePath: join(input.directory, 'release-notes.json'),
    fetch: input.fetchSpy,
    now: () => new Date('2026-11-03T00:00:00.000Z'),
    isCheckEnabled: async () => true,
    openExternal: async () => undefined,
    broadcast: () => undefined,
    log: () => undefined
  }
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'macrobay-update-gate-'))
  directories.push(directory)
  return directory
}

describe('the update check delivery gate', () => {
  it('maps the one read-only app fact to a mode: source runs are development', () => {
    expect(updateCheckModeFor(true)).toBe('packaged')
    expect(updateCheckModeFor(false)).toBe('development')
  })

  it('development registers every channel, but never arms the automatic timer', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('offline in this test')
    }) as unknown as typeof fetch
    const harness = recorder()
    const composition = await composeUpdateCheck(
      ports({ mode: 'development', directory: temporaryDirectory(), fetchSpy, ipcMain: harness.ipcMain })
    )

    // 用户 11-03 改的口径：开发态也能点出结果，所以通道**全都在**（旧写法「只注册 get-state」已作废）。
    expect(harness.channels).toEqual([
      IpcChannels.updatesGetState,
      IpcChannels.updatesCheckNow,
      IpcChannels.updatesOpenLink,
      IpcChannels.updatesGetReleaseNotes
    ])

    // 但初值是普通的「还没检查」——开发态不再是一种投影状态，画法与安装版完全一致。
    expect(composition.getProjection()).toEqual({ state: 'idle', currentVersion: '0.3.1' })

    // 手动查是真的：点一下发一次请求（这里让它离线，只为数调用次数）。
    const checkNow = harness.listeners.get(IpcChannels.updatesCheckNow) as () => Promise<unknown>
    await expect(checkNow()).resolves.toMatchObject({ state: 'unavailable' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('development arms no automatic check, so the source build never goes online on its own', async () => {
    vi.useFakeTimers()
    try {
      const fetchSpy = vi.fn(async () => {
        throw new Error('development must not fetch on its own')
      }) as unknown as typeof fetch
      const harness = recorder()
      const composition = await composeUpdateCheck(
        ports({ mode: 'development', directory: temporaryDirectory(), fetchSpy, ipcMain: harness.ipcMain })
      )

      // 这就是 `mode` 在开发态的唯一作用：**不挂自动检查**。15 秒是打包版的延迟，跑过去也不许发。
      composition.startAutomaticCheck()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('packaged registers all four channels, so the gate only closes the source build', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('no network in this test')
    }) as unknown as typeof fetch
    const harness = recorder()
    await composeUpdateCheck(
      ports({ mode: 'packaged', directory: temporaryDirectory(), fetchSpy, ipcMain: harness.ipcMain })
    )

    expect(harness.channels).toEqual([
      IpcChannels.updatesGetState,
      IpcChannels.updatesCheckNow,
      IpcChannels.updatesOpenLink,
      IpcChannels.updatesGetReleaseNotes
    ])
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
