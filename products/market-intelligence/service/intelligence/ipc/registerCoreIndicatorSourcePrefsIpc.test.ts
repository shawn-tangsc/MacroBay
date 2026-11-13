import { describe, expect, it, vi } from 'vitest'

import { INTELLIGENCE_IPC_METHODS } from '../../../contracts/intelligenceIpcMethods'
import {
  parseCoreIndicatorSourcePrefWrite,
  registerCoreIndicatorSourcePrefsIpc
} from './registerCoreIndicatorSourcePrefsIpc'

/**
 * 第二层配置的 IPC：两个方法、参数严格校验、读失败原样 reject。
 *
 * 这条守的是「写了但渲染层拿不到」那类错——以前 `registerCellEnabledIpc` 只被 import 没被调用，
 * 渲染层拿到的是「方法不存在」。所以这里断言两个方法都真的注册上了。
 */
function registrar() {
  const registered = new Map<string, (payload?: unknown) => Promise<unknown>>()
  return {
    registered,
    register: (productId: string, method: string, handler: (payload?: unknown) => Promise<unknown>) => {
      expect(productId).toBe('market-intelligence')
      registered.set(method, handler)
    }
  }
}

describe('core indicator source prefs IPC', () => {
  it('registers both methods', () => {
    const { register, registered } = registrar()
    const store = {
      readDisabled: vi.fn(async () => ({ 'US.CPI.NSA.YOY|narwhal': true })),
      setSourceEnabled: vi.fn(async () => undefined)
    }
    registerCoreIndicatorSourcePrefsIpc(register as never, store)
    expect([...registered.keys()].sort()).toEqual([
      INTELLIGENCE_IPC_METHODS.readCoreIndicatorSourcePrefs,
      INTELLIGENCE_IPC_METHODS.setCoreIndicatorSourcePref
    ].sort())
  })

  it('passes the read through untouched and refuses bad writes', async () => {
    const { register, registered } = registrar()
    const store = {
      readDisabled: vi.fn(async () => ({ 'US.CPI.NSA.YOY|narwhal': true })),
      setSourceEnabled: vi.fn(async () => undefined)
    }
    registerCoreIndicatorSourcePrefsIpc(register as never, store)

    const read = registered.get(INTELLIGENCE_IPC_METHODS.readCoreIndicatorSourcePrefs)!
    await expect(read()).resolves.toEqual({ 'US.CPI.NSA.YOY|narwhal': true })

    const write = registered.get(INTELLIGENCE_IPC_METHODS.setCoreIndicatorSourcePref)!
    await expect(write({ preferenceKey: 'US.CPI.NSA.YOY|narwhal', enabled: false })).resolves.toBeUndefined()
    expect(store.setSourceEnabled).toHaveBeenCalledWith('US.CPI.NSA.YOY|narwhal', false)

    // 坏参数直接抛，不猜：空键 / 非布尔。
    await expect(write({ preferenceKey: '', enabled: false })).rejects.toThrow(/preferenceKey/)
    await expect(write({ preferenceKey: 'k', enabled: 'yes' })).rejects.toThrow(/enabled/)
    expect(parseCoreIndicatorSourcePrefWrite({ preferenceKey: 'k', enabled: true })).toEqual({ preferenceKey: 'k', enabled: true })
  })

  it('propagates a read failure instead of pretending everything is on', async () => {
    const { register, registered } = registrar()
    const store = {
      readDisabled: vi.fn(async () => { throw new Error('disk gone') }),
      setSourceEnabled: vi.fn(async () => undefined)
    }
    registerCoreIndicatorSourcePrefsIpc(register as never, store)
    const read = registered.get(INTELLIGENCE_IPC_METHODS.readCoreIndicatorSourcePrefs)!
    // 读失败不能变成「全开」——那是替调用方做了一个它没做的决定。
    await expect(read()).rejects.toThrow('disk gone')
  })
})
