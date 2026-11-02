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

  it('development registers only get-state, says so, and never reaches the network', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('development must not fetch')
    }) as unknown as typeof fetch
    const harness = recorder()
    const composition = await composeUpdateCheck(
      ports({ mode: 'development', directory: temporaryDirectory(), fetchSpy, ipcMain: harness.ipcMain })
    )

    // 「开发版本，不检查更新」这句话的来源：投影里就是 development，不是 idle / unavailable。
    expect(composition.getProjection()).toEqual({ state: 'development' })
    expect(harness.channels).toEqual([IpcChannels.updatesGetState])

    // 另外三条通道**根本不存在**——零出网由「没有那条路」保证，不靠调用方自觉。
    expect(harness.listeners.has(IpcChannels.updatesCheckNow)).toBe(false)
    expect(harness.listeners.has(IpcChannels.updatesOpenLink)).toBe(false)
    expect(harness.listeners.has(IpcChannels.updatesGetReleaseNotes)).toBe(false)
    expect(harness.listeners.get(IpcChannels.updatesGetState)?.()).toEqual({ state: 'development' })
    expect(fetchSpy).not.toHaveBeenCalled()
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
