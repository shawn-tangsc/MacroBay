import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/intelligence-module-contracts-test' },
  net: { fetch: vi.fn(async () => new Response('{}', { status: 200 })) }
}))

/**
 * M1 抽出来的这一段自己的用例（2026-11-15 拆分 `intelligenceModule.ts`）。
 *
 * 三件事在这段代码搬走之后**最容易悄悄坏掉**，而且坏掉时别处不会有红：
 * 1. **加载即打的那条启动标记**——它是「现在跑的是哪个包」的唯一凭据，搬丢了一个字都不会报错；
 * 2. **产品 id 只有一个定义**——写成第二个字符串字面量，字符串比较会静默改语义；
 * 3. **原始记录补跑策略的吞错**——入队失败或观测超时必须让启动继续，否则整个产品起不来。
 */
describe('intelligenceModule 契约段', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('模块加载时打一条 MI_MAIN_STARTUP 标记，指向当前打包产物', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.resetModules()
    await import('./intelligenceModuleContracts')
    const line = log.mock.calls
      .map(([first]) => String(first))
      .find((candidate) => candidate.includes('MI_MAIN_STARTUP'))
    expect(line).toBeDefined()
    const marker = JSON.parse(line!) as Record<string, unknown>
    expect(marker.marker).toBe('MI_MAIN_STARTUP')
    expect(marker.productId).toBe('market-intelligence')
    // 包体积与构建时刻都得是数字/时刻，不是占位：读不到产物时这里会是 undefined。
    expect(typeof marker.bundleBytes).toBe('number')
    expect(Number.isNaN(Date.parse(String(marker.bundleBuiltAt)))).toBe(false)
  })

  /* 「原路径仍可读」不在这里用运行时断言：import 一次 `intelligenceModule` 要拉全量装配（实测 ~10s，
     破单条用例预算），而它已经由 `tsc` 守着——四个真实消费者（bootstrap、两个 IPC 模块、
     handlerRegistry）都从原路径取这个名字，导出没了是先编译红。这里只钉「值本身只有一处定义」。 */
  it('产品 id 只有一处定义，值不变', async () => {
    const contracts = await import('./intelligenceModuleContracts')
    expect(contracts.INTELLIGENCE_PRODUCT_ID).toBe('market-intelligence')
  })

  it('原始记录补跑仍是启动作业，且入队/观测失败时吞错不抛', async () => {
    const { intelligenceRawRecordStartupRecoveryPolicy: policy } = await import('./intelligenceModuleContracts')
    expect(policy.definition()).toEqual({
      id: 'market-intelligence.startup-recover-pending-raw-records',
      owner: 'product',
      productId: 'market-intelligence',
      handlerId: 'market-intelligence.normalizeRawRecords',
      title: 'Recover pending intelligence raw records',
      trigger: { kind: 'startup' },
      payload: {}
    })

    // ① 入队就失败：启动继续，不抛。
    const cannotEnqueue = {
      enqueueDefinition: vi.fn(async () => { throw new Error('queue unavailable') }),
      waitForRunTerminal: vi.fn(async () => ({ state: 'timeout' as const }))
    }
    await expect(policy.completeBeforeSourceRuntime(cannotEnqueue)).resolves.toBeUndefined()
    expect(cannotEnqueue.waitForRunTerminal).not.toHaveBeenCalled()

    // ② 入队成功但观测超时：同样吞掉，且超时预算是那 30 秒。
    const timesOut = {
      enqueueDefinition: vi.fn(async () => ({ id: 'startup-run-1' }) as never),
      waitForRunTerminal: vi.fn(async () => { throw new Error('timed out') })
    }
    await expect(policy.completeBeforeSourceRuntime(timesOut)).resolves.toBeUndefined()
    expect(timesOut.waitForRunTerminal).toHaveBeenCalledWith('startup-run-1', { timeoutMs: 30_000 })
  })
})
