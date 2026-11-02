import { describe, expect, it } from 'vitest'

import type { JsonFileStorage } from '../../storage/jsonFileStorage'
import { manualCooldownMs } from '../contracts/updateCheck'
import type { StoredUpdateCheckState } from './updateCheckState'
import { updateCheckTimeoutMs } from './updateCheckService'
import {
  createUpdateCheckService,
  type UpdateCheckMode,
  type UpdateCheckServicePorts
} from './updateCheckService'

type Harness = {
  service: Awaited<ReturnType<typeof createUpdateCheckService>>
  state: () => StoredUpdateCheckState
  writes: () => StoredUpdateCheckState[]
  fetchCalls: () => number
  order: () => string[]
  advance: (milliseconds: number) => void
  logs: () => Array<{ level: string; event: string; fields?: Record<string, unknown> }>
}

type HarnessOptions = {
  mode?: UpdateCheckMode
  currentVersion?: string
  platform?: string
  enabled?: boolean
  respond?: () => Promise<Response> | Response
  initialState?: Partial<StoredUpdateCheckState>
  startAt?: string
}

function makeHarness(options: HarnessOptions = {}): Promise<Harness> {
  let nowMs = Date.parse(options.startAt ?? '2026-11-03T00:10:00.000Z')
  let stored: StoredUpdateCheckState = {
    autoCheckedOnUtcDay: null,
    lastCheckedAt: null,
    lastSuccessAt: null,
    lastResult: null,
    lastManualCheckedAt: null,
    ...options.initialState
  }
  const writes: StoredUpdateCheckState[] = []
  const order: string[] = []
  const logs: Array<{ level: string; event: string; fields?: Record<string, unknown> }> = []
  let fetchCalls = 0

  const ports: UpdateCheckServicePorts = {
    mode: options.mode ?? 'packaged',
    currentVersion: options.currentVersion ?? '0.3.1',
    platform: options.platform ?? 'darwin',
    storage: {
      read: async () => stored,
      write: async (value) => {
        stored = value
        writes.push(value)
        order.push('persist')
      }
    },
    fetch: (async () => {
      fetchCalls += 1
      order.push('fetch')
      return options.respond ? options.respond() : new Response('version: 0.4.0\n', { status: 200 })
    }) as unknown as typeof fetch,
    now: () => new Date(nowMs),
    isCheckEnabled: async () => options.enabled ?? true,
    log: (level, event, fields) => {
      logs.push({ level, event, fields })
    }
  }

  return createUpdateCheckService(ports).then((service) => ({
    service,
    state: () => stored,
    writes: () => writes,
    fetchCalls: () => fetchCalls,
    order: () => order,
    advance: (milliseconds) => {
      nowMs += milliseconds
    },
    logs: () => logs
  }))
}

describe('the update check service', () => {
  it('reports a newer release and remembers it', async () => {
    const harness = await makeHarness()

    const projection = await harness.service.checkNow('manual')

    expect(projection).toEqual({
      state: 'available',
      currentVersion: '0.3.1',
      latestVersion: '0.4.0',
      checkedAt: '2026-11-03T00:10:00.000Z'
    })
    expect(harness.state().lastSuccessAt).toBe('2026-11-03T00:10:00.000Z')
    expect(harness.state().lastResult).toMatchObject({ status: 'available', latestVersion: '0.4.0' })
  })

  it('takes the current version from the caller, so the main path can be tested at all', async () => {
    const harness = await makeHarness({ currentVersion: '0.4.0' })
    expect(await harness.service.checkNow()).toMatchObject({ state: 'up-to-date' })
  })

  it('turns a 404 into "cannot tell", never into "up to date"', async () => {
    const harness = await makeHarness({ respond: () => new Response('', { status: 404 }) })

    const projection = await harness.service.checkNow('manual')

    expect(projection).toMatchObject({ state: 'unavailable', checkedAt: '2026-11-03T00:10:00.000Z' })
    expect(harness.state().lastResult).toMatchObject({ status: 'unavailable', reason: 'not-found' })
  })

  it('turns a network rejection into "cannot tell" and keeps the last successful time', async () => {
    const harness = await makeHarness({
      initialState: { lastSuccessAt: '2026-11-02T09:00:00.000Z' },
      respond: () => Promise.reject(new Error('net::ERR_INTERNET_DISCONNECTED'))
    })

    const projection = await harness.service.checkNow('manual')

    // 界面显示的是「这一次尝试」的时刻；上次成功的时刻不进界面，只留在结论里。
    expect(projection).toEqual({
      state: 'unavailable',
      currentVersion: '0.3.1',
      checkedAt: '2026-11-03T00:10:00.000Z'
    })
    expect(harness.state().lastResult).toMatchObject({ lastSuccessAt: '2026-11-02T09:00:00.000Z' })
    expect(harness.state().lastResult).toMatchObject({ status: 'unavailable', reason: 'offline' })
  })

  it('turns broken metadata into "cannot tell" instead of a fake version', async () => {
    const harness = await makeHarness({ respond: () => new Response('files:\n  - url: x\n', { status: 200 }) })

    expect(await harness.service.checkNow('manual')).toMatchObject({ state: 'unavailable' })
    expect(harness.state().lastResult).toMatchObject({ status: 'unavailable', reason: 'invalid-metadata' })
  })

  it('ignores a prerelease while the reader is on a stable version', async () => {
    const harness = await makeHarness({ respond: () => new Response('version: 0.4.0-alpha\n', { status: 200 }) })

    expect(await harness.service.checkNow('manual')).toMatchObject({ state: 'up-to-date', latestVersion: '0.3.1' })
  })

  it('writes the UTC day bucket before it sends the request', async () => {
    const harness = await makeHarness()

    await harness.service.checkNow('auto')

    // 顺序是「先记账、再出网」：反过来的话，请求卡住就会在同一天反复出网。
    expect(harness.order().slice(0, 2)).toEqual(['persist', 'fetch'])
    expect(harness.state().autoCheckedOnUtcDay).toBe('2026-11-03')
  })

  it('checks at most once per UTC day, no matter how often the app starts', async () => {
    const harness = await makeHarness()

    await harness.service.checkNow('auto')
    expect(harness.fetchCalls()).toBe(1)

    // 同一天再启动两次：一个请求都不发。
    harness.advance(60 * 60 * 1000)
    await harness.service.checkNow('auto')
    harness.advance(60 * 60 * 1000)
    await harness.service.checkNow('auto')
    expect(harness.fetchCalls()).toBe(1)

    // 过了 UTC 零点就是新的一天。
    harness.advance(24 * 60 * 60 * 1000)
    await harness.service.checkNow('auto')
    expect(harness.fetchCalls()).toBe(2)
  })

  it('lets a manual check through on a day the automatic one already ran', async () => {
    const harness = await makeHarness()

    await harness.service.checkNow('auto')
    // 手动免日桶：这是「当天那次自动检查被掐掉」之后唯一的出路。
    harness.advance(5 * 60 * 1000)
    await harness.service.checkNow('manual')

    expect(harness.fetchCalls()).toBe(2)
  })

  it('sends nothing inside the manual cooldown and does not extend it', async () => {
    const harness = await makeHarness()
    await harness.service.checkNow('manual')
    expect(harness.fetchCalls()).toBe(1)

    harness.advance(30 * 1000)
    const cooled = await harness.service.checkNow('manual')
    expect(harness.fetchCalls()).toBe(1)
    // 冷却中返回的是上次结论，不是「正在检查」或「查不到」。
    expect(cooled).toMatchObject({ state: 'available', latestVersion: '0.4.0' })

    harness.advance(manualCooldownMs - 30 * 1000 + 1)
    await harness.service.checkNow('manual')
    expect(harness.fetchCalls()).toBe(2)
  })

  it('does not treat a backwards clock as an endless cooldown', async () => {
    const harness = await makeHarness()
    await harness.service.checkNow('manual')

    harness.advance(-10 * 60 * 1000)
    await harness.service.checkNow('manual')

    expect(harness.fetchCalls()).toBe(2)
  })

  it('sends nothing at all while the automatic switch is off', async () => {
    const harness = await makeHarness({ enabled: false })

    await harness.service.checkNow('auto')
    expect(harness.fetchCalls()).toBe(0)
    expect(harness.state().autoCheckedOnUtcDay).toBeNull()
  })

  it('still allows a manual check while the automatic switch is off', async () => {
    const harness = await makeHarness({ enabled: false })

    // 关掉的只是「自动查」，不许把手动一起拦住。
    expect(await harness.service.checkNow('manual')).toMatchObject({ state: 'available' })
    expect(harness.fetchCalls()).toBe(1)
  })

  it('does not fetch at all on a platform without release metadata', async () => {
    const harness = await makeHarness({ platform: 'linux' })

    expect(await harness.service.checkNow('manual')).toMatchObject({ state: 'unavailable' })
    expect(harness.fetchCalls()).toBe(0)
    expect(harness.state().lastResult).toMatchObject({ reason: 'unsupported-platform' })
  })

  it('coalesces two clicks into one request', async () => {
    let release: (response: Response) => void = () => undefined
    const pending = new Promise<Response>((resolve) => {
      release = resolve
    })
    const harness = await makeHarness({ respond: () => pending })

    const first = harness.service.checkNow('manual')
    const second = harness.service.checkNow('manual')
    // 记账是先落盘的，请求还没发出去；等那一小段异步过去再放行响应。
    await new Promise((resolve) => setTimeout(resolve, 0))
    release(new Response('version: 0.4.0\n', { status: 200 }))

    await Promise.all([first, second])
    expect(harness.fetchCalls()).toBe(1)
  })

  it('keeps the previous conclusion when a later check cannot tell', async () => {
    let respond: () => Response = () => new Response('version: 0.4.0\n', { status: 200 })
    const harness = await makeHarness({ respond: () => respond() })

    await harness.service.checkNow('manual')
    respond = () => new Response('', { status: 500 })
    harness.advance(manualCooldownMs + 1)

    // 查不到要说查不到：结论被换成 unavailable，但「上次成功那一刻」还在，那行不至于变成死行。
    expect(await harness.service.checkNow('manual')).toMatchObject({
      state: 'unavailable',
      checkedAt: '2026-11-03T00:11:00.001Z'
    })
  })

  it('logs expected failures as information, not as errors', async () => {
    const harness = await makeHarness({ respond: () => new Response('', { status: 404 }) })

    await harness.service.checkNow('manual')

    const finished = harness.logs().find((entry) => entry.event === 'update.check.finished')
    expect(finished?.level).toBe('info')
    expect(finished?.fields).toMatchObject({ status: 'unavailable', reason: 'not-found' })
  })
})

describe('the request ceiling', () => {
  it('waits long enough for a first request that is slow on purpose to succeed', () => {
    // 本机实测：同一台机器上第一次请求 17 秒才通、第二次 200。自动检查一天只有一次机会，
    // 10 秒会把「其实能查到」每天静默判成「查不到」——所以下限写死在这里。
    expect(updateCheckTimeoutMs).toBeGreaterThanOrEqual(20_000)
  })
})

describe('development mode', () => {
  it('projects "no capability" and logs it once as information', async () => {
    const harness = await makeHarness({ mode: 'development' })

    expect(harness.service.getProjection()).toEqual({ state: 'development' })
    expect(harness.logs().filter((entry) => entry.event === 'update.check.disabled')).toHaveLength(1)
    expect(harness.logs().every((entry) => entry.level !== 'error')).toBe(true)
  })

  it('refuses to run a check instead of pretending there is one', async () => {
    const harness = await makeHarness({ mode: 'development' })

    // 开发态这条通道不注册；真被调用必须是响亮地失败，不是 resolve 一个「不可用」。
    await expect(harness.service.checkNow('manual')).rejects.toThrow(/development/iu)
    expect(harness.fetchCalls()).toBe(0)
  })
})

describe('state file tolerance', () => {
  it('falls back to an empty bookkeeping file instead of freezing the feature', async () => {
    let stored: StoredUpdateCheckState | null = null
    const logs: string[] = []
    const service = await createUpdateCheckService({
      mode: 'packaged',
      currentVersion: '0.3.1',
      platform: 'darwin',
      storage: {
        read: async () => {
          throw new Error('Unexpected token < in JSON')
        },
        write: async (value) => {
          stored = value
        }
      },
      fetch: (async () => new Response('version: 0.4.0\n', { status: 200 })) as unknown as typeof fetch,
      now: () => new Date('2026-11-03T00:10:00.000Z'),
      isCheckEnabled: async () => true,
      log: (level, event) => logs.push(`${level}:${event}`)
    })

    expect(await service.checkNow('manual')).toMatchObject({ state: 'available' })
    expect(stored).not.toBeNull()
    expect(logs).toContain('warn:update.check.state-read-failed')
  })
})

