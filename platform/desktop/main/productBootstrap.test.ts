import { describe, expect, it, vi } from 'vitest'

import { runProductRegistration } from '../../product-registry/productRegistrationFailure'
import {
  PRODUCT_BOOTSTRAP_FAILED_CODE,
  PRODUCT_BOOTSTRAP_FAILED_EVENT,
  runProductBootstrap
} from './productBootstrap'

function createHarness() {
  const log = vi.fn()
  const markUnavailable = vi.fn()
  return { log, markUnavailable, deps: { log: { log }, markUnavailable } }
}

/** 记一条「失败时必须有的东西」：事件名、稳定码、阶段、产品 id、可读原因。 */
function expectFailureLogged(
  log: ReturnType<typeof createHarness>['log'],
  stage: string,
  reason: string,
  productId: string | null = null
): void {
  expect(log).toHaveBeenCalledTimes(1)
  // 日志字段叫 `message`（原文）：屏幕上的 `reason` 是它脱敏后的派生，两者不能同名。
  expect(log).toHaveBeenCalledWith('error', PRODUCT_BOOTSTRAP_FAILED_EVENT, {
    code: PRODUCT_BOOTSTRAP_FAILED_CODE,
    stage,
    productId,
    message: reason
  })
}

describe('product bootstrap failure logging', () => {
  it('logs a named failure and degrades when product registration throws', async () => {
    const { log, markUnavailable, deps } = createHarness()
    const sealIpcSurface = vi.fn()

    const result = await runProductBootstrap(
      {
        registerProductServices: async () => {
          throw new Error('product route "mind.intel.dashboard" is not declared')
        },
        sealIpcSurface
      },
      deps
    )

    expect(result.ok).toBe(false)
    expectFailureLogged(log, 'register-product-services', 'product route "mind.intel.dashboard" is not declared')
    expect(markUnavailable).toHaveBeenCalledTimes(1)
    // 注册失败就不该继续封口：封一个空面会让后续步骤以为启动成功。
    expect(sealIpcSurface).not.toHaveBeenCalled()
  })

  it('names the sealing stage when sealing the IPC surface throws', async () => {
    const { log, markUnavailable, deps } = createHarness()

    const result = await runProductBootstrap(
      {
        registerProductServices: async () => undefined,
        sealIpcSurface: () => {
          throw new Error('duplicate ipc method')
        }
      },
      deps
    )

    expect(result.ok).toBe(false)
    expectFailureLogged(log, 'seal-ipc-surface', 'duplicate ipc method')
    expect(markUnavailable).toHaveBeenCalledTimes(1)
  })

  it('names the acceptance stage when the acceptance report throws', async () => {
    const { log, markUnavailable, deps } = createHarness()

    const result = await runProductBootstrap(
      {
        registerProductServices: async () => undefined,
        sealIpcSurface: () => ({ methodCount: 3 }),
        reportAcceptance: () => {
          throw new Error('acceptance sink closed')
        }
      },
      deps
    )

    expect(result.ok).toBe(false)
    expectFailureLogged(log, 'report-acceptance', 'acceptance sink closed')
    expect(markUnavailable).toHaveBeenCalledTimes(1)
  })

  it('keeps a readable reason when the thrown value is not an Error', async () => {
    const { log, deps } = createHarness()

    const result = await runProductBootstrap(
      {
        registerProductServices: async () => {
          throw 'module not found'
        },
        sealIpcSurface: () => undefined
      },
      deps
    )

    expect(result.ok).toBe(false)
    expectFailureLogged(log, 'register-product-services', 'module not found')
  })

  it('names the product that failed when the registration carries the id', async () => {
    const { log, deps } = createHarness()

    const result = await runProductBootstrap(
      {
        registerProductServices: async () => {
          // 生成文件里每个产品各包一层，抛出的错误自带 id。
          await runProductRegistration('market-intelligence', () => {
            throw new Error('route "mind.intel.dashboard" is not declared')
          })
        },
        sealIpcSurface: () => undefined
      },
      deps
    )

    expect(result.ok).toBe(false)
    expectFailureLogged(
      log,
      'register-product-services',
      'product "market-intelligence" failed to register: route "mind.intel.dashboard" is not declared',
      'market-intelligence'
    )
  })

  it('builds one failure record and names the two layers apart', async () => {
    const { log, deps } = createHarness()

    const result = await runProductBootstrap(
      {
        registerProductServices: async () => {
          throw new Error('route "mind.intel.dashboard" is not declared')
        },
        sealIpcSurface: () => undefined
      },
      deps
    )

    if (result.ok) throw new Error('expected the registration to fail')
    const logged = log.mock.calls[0][2] as Record<string, unknown>
    const failure: Record<string, unknown> = { ...result.failure }

    // 同名两样东西比异名同一样东西更难发现：grep 出来是一个词，含义却不同。
    expect(Object.keys(logged).sort()).toEqual(['code', 'message', 'productId', 'stage'])
    expect(Object.keys(failure).sort()).toEqual(['code', 'productId', 'reason', 'stage'])
    // 但值必须来自同一次读取，不能靠两次调用恰好相等。
    expect(failure.reason).toBe(logged.message)
    expect(failure.productId).toBe(logged.productId)
  })

  it('stays silent and does not degrade when every step succeeds', async () => {
    const { log, markUnavailable, deps } = createHarness()
    const reportAcceptance = vi.fn()

    const result = await runProductBootstrap(
      {
        registerProductServices: async () => undefined,
        sealIpcSurface: () => ({ methodCount: 7 }),
        reportAcceptance
      },
      deps
    )

    expect(result.ok).toBe(true)
    expect(log).not.toHaveBeenCalled()
    expect(markUnavailable).not.toHaveBeenCalled()
    // 封口结果是交给验收报告的，不是给某个模块自己再算一遍。
    expect(reportAcceptance).toHaveBeenCalledWith({ methodCount: 7 })
  })
})
