import { describe, expect, it, vi } from 'vitest'

import {
  autoRetryTrigger, autoRetryWindowMs, createAutoRetryingResolve, environmentFailureCodes,
  isEnvironmentFailure, shouldAutoRetry
} from './dailyBriefingAutoRetry'

const CUTOFF = '2026-11-07T23:00:00.000Z'

describe('only environment failures are retried', () => {
  // 用户 2026-11-06：应用被关、超时、返回不合法或不合格式 —— 重试有意义；配置类重试只会再失败一次。
  it('treats a closed app, a timeout and an unreadable reply as environment failures', () => {
    for (const code of ['run-interrupted', 'editorial-timeout', 'run-timeout', 'invalid-json', 'invalid-shape', 'schema-validation-failed', 'provider-error', 'agent-turn-output-truncated']) {
      expect(isEnvironmentFailure(code), code).toBe(true)
    }
  })

  it('is the closed set `02` v2.166 lists — one missing code is one retry the reader never gets', () => {
    // 闭集：多一个会白烧调用，少一个读者就少一次自动重试。这张表就是判据本身。
    // 裸码 `timeout` 已经删掉：日报运行永远不会返回它（AI 超时先映射成 `editorial-timeout`），
    // 留着就是代码自己承认永远不会发生的死码；换进来的是真会发生的 provider 报错与单轮截断。
    expect([...environmentFailureCodes].sort()).toEqual([
      'agent-turn-output-truncated', 'editorial-timeout', 'invalid-json', 'invalid-shape',
      'provider-error', 'run-interrupted', 'run-timeout', 'schema-validation-failed'
    ])
    expect(environmentFailureCodes).toHaveLength(8)
    expect(isEnvironmentFailure('timeout'), '裸 timeout 是死码，不许回到集合里').toBe(false)
  })

  it('never treats a configuration failure as retryable', () => {
    for (const code of ['model-not-ready', 'provider-disabled', 'missing-api-key', 'model-unavailable', 'rate-limited']) {
      expect(isEnvironmentFailure(code), code).toBe(false)
    }
    expect(isEnvironmentFailure(undefined)).toBe(false)
  })

  it('retries once within the hour and not a minute after', () => {
    const at = (offsetMs: number): string => new Date(Date.parse(CUTOFF) + offsetMs).toISOString()
    expect(shouldAutoRetry({ failureCode: 'invalid-json', cutoff: CUTOFF, now: at(autoRetryWindowMs) })).toBe(true)
    expect(shouldAutoRetry({ failureCode: 'invalid-json', cutoff: CUTOFF, now: at(autoRetryWindowMs + 1) })).toBe(false)
  })

  it('treats the window as a closed interval — a cutoff still in the future is not a failure', () => {
    // 下界也判（`02` v2.166）：统计截止还在未来时这一版根本没到点，重试会把"还没到点"当成"失败过一次"。
    const at = (offsetMs: number): string => new Date(Date.parse(CUTOFF) + offsetMs).toISOString()
    expect(shouldAutoRetry({ failureCode: 'invalid-json', cutoff: CUTOFF, now: at(0) }), '正好在截止：可重试').toBe(true)
    expect(shouldAutoRetry({ failureCode: 'invalid-json', cutoff: CUTOFF, now: at(-1) }), '截止还没到：不重试').toBe(false)
    expect(shouldAutoRetry({ failureCode: 'invalid-json', cutoff: CUTOFF, now: at(-autoRetryWindowMs) })).toBe(false)
  })

  it('does not start a second run while the app is closing — the typed signal, not a guess', () => {
    // 架构师 2026-11-07 的保留项：应用正在关闭时再起一次，只会多一条注定失败的尝试、多烧一次会话。
    const aborting = new AbortController()
    aborting.abort()
    expect(shouldAutoRetry({ failureCode: 'invalid-json', cutoff: CUTOFF, now: CUTOFF, runtimeAlive: false })).toBe(false)
    const alive = new AbortController()
    expect(shouldAutoRetry({ failureCode: 'invalid-json', cutoff: CUTOFF, now: CUTOFF, runtimeAlive: true })).toBe(true)
    expect(alive.signal.aborted).toBe(false)
  })

  it('never retries a run that is already a retry — manual or automatic', () => {
    expect(shouldAutoRetry({ failureCode: 'invalid-json', cutoff: CUTOFF, now: CUTOFF, runTrigger: 'retry' })).toBe(false)
    expect(shouldAutoRetry({ failureCode: 'invalid-json', cutoff: CUTOFF, now: CUTOFF, runTrigger: autoRetryTrigger })).toBe(false)
  })
})

describe('the retrying entry point', () => {
  const harness = (results: readonly Readonly<{ state: string; failureCode?: string }>[]) => {
    const run = vi.fn(async (_input: unknown, _force: boolean) => results[Math.min(run.mock.calls.length - 1, results.length - 1)]!)
    const resolve = createAutoRetryingResolve({
      run: run as never,
      now: () => CUTOFF
    })
    return { run, resolve }
  }
  const failure = (failureCode: string) => ({ state: 'unavailable' as const, failureCode })

  it('runs exactly twice after an environment failure, the second time as an automatic retry', async () => {
    const { run, resolve } = harness([failure('invalid-json'), { state: 'available' }])
    const result = await resolve({ asOf: CUTOFF }, true)
    expect(result.state).toBe('available')
    expect(run).toHaveBeenCalledTimes(2)
    // 留痕：第二次的触发是 `auto-retry`，列表上来源写「自动重试」——与读者手点的「重试」不同词。
    expect(run.mock.calls[1]![0]).toMatchObject({ runTrigger: autoRetryTrigger })
    expect(autoRetryTrigger).not.toBe('retry')
  })

  it('does not retry a configuration failure', async () => {
    const { run, resolve } = harness([failure('model-unavailable')])
    const result = await resolve({ asOf: CUTOFF }, true)
    expect(result).toEqual(failure('model-unavailable'))
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('does not retry when the retry itself fails — one try only', async () => {
    const { run, resolve } = harness([failure('invalid-json'), failure('invalid-json')])
    const result = await resolve({ asOf: CUTOFF }, true)
    expect(result).toEqual(failure('invalid-json'))
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('reads “still alive” from the run’s own abort signal when no predicate is given', async () => {
    const aborted = new AbortController()
    aborted.abort()
    const run = vi.fn(async () => failure('invalid-json'))
    const resolve = createAutoRetryingResolve({ run: run as never, now: () => CUTOFF })
    await resolve({ asOf: CUTOFF, signal: aborted.signal }, true)
    expect(run, '信号已 abort：一次都不许再起').toHaveBeenCalledTimes(1)

    const aliveRun = vi.fn(async () => failure('invalid-json'))
    const alive = createAutoRetryingResolve({ run: aliveRun as never, now: () => CUTOFF })
    await alive({ asOf: CUTOFF, signal: new AbortController().signal }, true)
    expect(aliveRun, '信号还活着：照常重试一次').toHaveBeenCalledTimes(2)
  })

  it('does not retry outside the hour window', async () => {
    const run = vi.fn(async () => failure('invalid-json'))
    const resolve = createAutoRetryingResolve({
      run: run as never,
      now: () => new Date(Date.parse(CUTOFF) + autoRetryWindowMs + 1).toISOString()
    })
    await resolve({ asOf: CUTOFF }, true)
    expect(run).toHaveBeenCalledTimes(1)
  })
})
