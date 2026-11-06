import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { IpcChannels } from '../../ipc/channels'

import { composeUpdateCheck, type UpdateCheckCompositionPorts } from './updateCheck'

/**
 * 更新检查的装配：**只有一条路**。
 *
 * 11-03 用户定了「源码启动和装好的包不必区别对待」，所以这里没有 `mode`、没有「开发态只注册一部分
 * 通道」也没有「开发态不挂定时器」。省下的风险由服务里那道**同一个 UTC 自然日最多一次**承担：
 * 开发机每天最多多打一次请求，不会变成每开一次窗就打一发。
 */

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
  directory: string
  fetchSpy: typeof fetch
  ipcMain: IpcMainPort
}): UpdateCheckCompositionPorts {
  return {
    ipcMain: input.ipcMain,
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
  const directory = mkdtempSync(join(tmpdir(), 'macrobay-update-composition-'))
  directories.push(directory)
  return directory
}

describe('composing the update check', () => {
  it('registers every channel, and starts out as "not checked yet"', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('offline in this test')
    }) as unknown as typeof fetch
    const harness = recorder()
    const composition = await composeUpdateCheck(
      ports({ directory: temporaryDirectory(), fetchSpy, ipcMain: harness.ipcMain })
    )

    expect(harness.channels).toEqual([
      IpcChannels.updatesGetState,
      IpcChannels.updatesCheckNow,
      IpcChannels.updatesOpenLink,
      IpcChannels.updatesGetReleaseNotes
    ])
    expect(composition.getProjection()).toEqual({ state: 'idle', currentVersion: '0.3.1' })

    // 手动查真的发请求（这里让它离线，只为数调用次数）。
    const checkNow = harness.listeners.get(IpcChannels.updatesCheckNow) as () => Promise<unknown>
    await expect(checkNow()).resolves.toMatchObject({ state: 'unavailable' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('arms the automatic check after the first screen, like an installed build', async () => {
    vi.useFakeTimers()
    try {
      const fetchSpy = vi.fn(async () => {
        throw new Error('offline in this test')
      }) as unknown as typeof fetch
      const harness = recorder()
      const composition = await composeUpdateCheck(
        ports({ directory: temporaryDirectory(), fetchSpy, ipcMain: harness.ipcMain })
      )

      expect(fetchSpy).not.toHaveBeenCalled()
      composition.startAutomaticCheck()
      // `vi.waitFor` 会自动推进假定时器，并真的给异步链路（读文件、写文件）留出轮次；
      // 只 `advanceTimersByTimeAsync` 会在「写记账文件」那步还没落地时就看断言。
      // 先把 15 秒的假定时器推过去，再给异步尾巴（读/写记账文件）留轮次。
      await vi.advanceTimersByTimeAsync(20_000)
      await vi.waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(1)
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not spend a second automatic request on the same UTC day', async () => {
    vi.useFakeTimers()
    try {
      const fetchSpy = vi.fn(async () => {
        throw new Error('offline in this test')
      }) as unknown as typeof fetch
      const directory = temporaryDirectory()

      // 同一个数据目录、同一天，起两次「应用」：第二次不该再发请求。
      for (let round = 0; round < 2; round += 1) {
        const harness = recorder()
        const composition = await composeUpdateCheck(
          ports({ directory, fetchSpy, ipcMain: harness.ipcMain })
        )
        composition.startAutomaticCheck()
        await vi.advanceTimersByTimeAsync(20_000)
        await vi.waitFor(() => {
          expect(fetchSpy).toHaveBeenCalledTimes(1)
        })
        // 走完这一轮，再等一拍，确认没有第二个请求挤进来。
        await vi.advanceTimersByTimeAsync(60_000)
      }
    } finally {
      vi.useRealTimers()
    }
  })
})
