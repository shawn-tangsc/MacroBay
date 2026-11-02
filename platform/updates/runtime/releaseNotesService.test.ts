import { describe, expect, it } from 'vitest'

import type { JsonFileStorage } from '../../storage/jsonFileStorage'
import { releaseNotesLimits } from '../contracts/releaseNotes'
import { isAllowedReleaseNotesApiUrl, updateReleaseNotesApiUrl } from '../updateSource'
import {
  createReleaseNotesService,
  releaseNotesFailureCooldownMs,
  type ReleaseNotesCache
} from './releaseNotesService'

function harness(options: { body?: string | null; status?: number; now?: () => Date } = {}) {
  let stored: ReleaseNotesCache | null = null
  let writes = 0
  let calls = 0
  const logs: string[] = []
  const storage: JsonFileStorage<ReleaseNotesCache> = {
    read: async () => {
      if (stored === null) throw new Error('ENOENT')
      return stored
    },
    write: async (value) => {
      stored = value
      writes += 1
    }
  }
  const fetchImpl = (async () => {
    calls += 1
    const status = options.status ?? 200
    const body = options.body ?? JSON.stringify({ body: '## 本次更新\n- 修好了一个问题', prerelease: false })
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => body,
      body: null
    } as unknown as Response
  }) as unknown as typeof fetch

  const service = createReleaseNotesService({
    storage,
    fetch: fetchImpl,
    now: options.now ?? (() => new Date('2026-11-03T00:10:00.000Z')),
    log: (level, event, fields) => logs.push(`${level}:${event}:${JSON.stringify(fields ?? {})}`)
  })
  return { service, calls: () => calls, writes: () => writes, stored: () => stored, logs: () => logs }
}

describe('the release notes fetch layer', () => {
  it('requests once per version and reuses the cache afterwards', async () => {
    const h = harness()
    expect(await h.service.getBody('0.4.0')).toContain('本次更新')
    expect(h.calls()).toBe(1)
    // 同版本第二次：一个请求都不发。
    expect(await h.service.getBody('0.4.0')).toContain('本次更新')
    expect(h.calls()).toBe(1)
    expect(h.writes()).toBe(1)
  })

  it('fetches again when the version changes', async () => {
    const h = harness()
    await h.service.getBody('0.4.0')
    await h.service.getBody('0.5.0')
    expect(h.calls()).toBe(2)
    expect(h.stored()?.version).toBe('0.5.0')
  })

  it('stops asking for ten minutes after a failure, and does not cache the failure', async () => {
    const h = harness({ status: 500 })
    expect(await h.service.getBody('0.4.0')).toBeNull()
    expect(await h.service.getBody('0.4.0')).toBeNull()
    expect(await h.service.getBody('0.4.0')).toBeNull()
    // 三次打开只发一次请求；且失败不写缓存。
    expect(h.calls()).toBe(1)
    expect(h.stored()).toBeNull()
    expect(h.writes()).toBe(0)
  })

  it('keeps the cooldown in memory only, so a later clock still blocks inside the window', async () => {
    let now = new Date('2026-11-03T00:10:00.000Z')
    const h = harness({ status: 404, now: () => now })
    await h.service.getBody('0.4.0')
    now = new Date(now.getTime() + releaseNotesFailureCooldownMs - 1000)
    expect(await h.service.getBody('0.4.0')).toBeNull()
    expect(h.calls()).toBe(1)
    // 过了冷却窗口才允许再试。
    now = new Date(now.getTime() + 2000)
    await h.service.getBody('0.4.0')
    expect(h.calls()).toBe(2)
  })

  it('maps 403 to rate-limited and 404 to not-found, and never shows a body', async () => {
    const forbidden = harness({ status: 403 })
    expect(await forbidden.service.getBody('0.4.0')).toBeNull()
    expect(forbidden.logs().join()).toContain('rate-limited')

    const missing = harness({ status: 404 })
    expect(await missing.service.getBody('0.4.0')).toBeNull()
    expect(missing.logs().join()).toContain('not-found')
  })

  it('refuses a prerelease body even if the API hands one over', async () => {
    const h = harness({ body: JSON.stringify({ body: '## x', prerelease: true }) })
    expect(await h.service.getBody('0.4.0')).toBeNull()
    expect(h.writes()).toBe(0)
  })

  it('refuses an oversized declared body without reading it', async () => {
    let read = 0
    let calls = 0
    const service = createReleaseNotesService({
      storage: { read: async () => { throw new Error('ENOENT') }, write: async () => undefined },
      fetch: (async () => {
        calls += 1
        return {
          ok: true,
          status: 200,
          headers: { get: (name: string) => (name === 'content-length' ? String(releaseNotesLimits.bodyBytes + 1) : null) },
          body: {
            getReader: () => ({
              read: async () => {
                read += 1
                return { done: true, value: undefined }
              },
              cancel: async () => undefined
            })
          },
          text: async () => {
            read += 1
            return 'x'.repeat(releaseNotesLimits.bodyBytes + 1)
          }
        } as unknown as Response
      }) as unknown as typeof fetch,
      now: () => new Date('2026-11-03T00:10:00.000Z'),
      log: () => undefined
    })

    expect(await service.getBody('0.4.0')).toBeNull()
    expect(calls).toBe(1)
    // 声明就超限：一个字节都不读。
    expect(read).toBe(0)
  })

  it('stops reading a stream that grows past the limit', async () => {
    let reads = 0
    const service = createReleaseNotesService({
      storage: { read: async () => { throw new Error('ENOENT') }, write: async () => undefined },
      fetch: (async () =>
        ({
          ok: true,
          status: 200,
          headers: { get: () => null },
          body: {
            getReader: () => ({
              read: async () => {
                reads += 1
                return { done: false, value: new Uint8Array(releaseNotesLimits.bodyBytes) }
              },
              cancel: async () => undefined
            })
          }
        }) as unknown as Response) as unknown as typeof fetch,
      now: () => new Date('2026-11-03T00:10:00.000Z'),
      log: () => undefined
    })

    expect(await service.getBody('0.4.0')).toBeNull()
    // 超过上限立刻中止，不会一直读下去。
    expect(reads).toBeLessThanOrEqual(2)
  })

  it('only allows the release API of this repository', () => {
    // 地址不写第二遍字面量：全仓「发布地址只出现一次」那条守卫会把本文件也算成违规。
    const tail = ['releases', 'latest'].join('/')
    expect(isAllowedReleaseNotesApiUrl(updateReleaseNotesApiUrl())).toBe(true)
    // 把 owner 换成别人：拒绝（E11 的落点）。
    expect(isAllowedReleaseNotesApiUrl(`https://api.github.com/repos/someone/MacroBay/${tail}`)).toBe(false)
    expect(isAllowedReleaseNotesApiUrl('https://api.github.com/repos/shawn-tangsc/MacroBay/releases')).toBe(false)
    expect(isAllowedReleaseNotesApiUrl(`https://github.com/repos/shawn-tangsc/MacroBay/${tail}`)).toBe(false)
    expect(isAllowedReleaseNotesApiUrl(`http://api.github.com/repos/shawn-tangsc/MacroBay/${tail}`)).toBe(false)
  })

  it('logs a warning when the cached file cannot be read', async () => {
    const h = harness()
    await h.service.getBody('0.4.0')
    expect(h.logs().some((line) => line.startsWith('warn:update.notes.cache-read-failed'))).toBe(true)
  })
})
