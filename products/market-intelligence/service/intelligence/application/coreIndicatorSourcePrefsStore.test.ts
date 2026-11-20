import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  coreIndicatorSourcePreferenceKey,
  createCoreIndicatorSourcePrefsStore,
  enabledValueSources
} from './coreIndicatorSourcePrefsStore'

/**
 * 第二层配置（`(metric_key, provider_id)`）的三条口径（架构师 2026-11-14）：
 * 只记「关」、缺行即开；退休源的记录要忽略；读不懂的文档不能把「关」读成「开」以外的第二种意思。
 */
let file = ''

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'core-indicator-prefs-'))
  file = join(dir, 'core-indicator-sources.json')
})

describe('core indicator source preferences', () => {
  it('treats a missing key as ON, so a new metric or source is never silently off', async () => {
    const store = createCoreIndicatorSourcePrefsStore(file)
    await expect(store.readDisabled()).resolves.toEqual({})
    await store.setSourceEnabled(coreIndicatorSourcePreferenceKey('US.CPI.NSA.YOY', 'narwhal'), true)
    // 「开」不写进文档：写一次 true 之后文档里仍然没有这个键。
    await expect(store.readDisabled()).resolves.toEqual({})
  })

  it('records only the ones the reader turned off, and clears the key when turned back on', async () => {
    const store = createCoreIndicatorSourcePrefsStore(file)
    const key = coreIndicatorSourcePreferenceKey('US.NONFARM.SA.CHANGE', 'bls')
    await store.setSourceEnabled(key, false)
    await expect(store.readDisabled()).resolves.toEqual({ [key]: true })
    await store.setSourceEnabled(key, true)
    await expect(store.readDisabled()).resolves.toEqual({})
    const document = JSON.parse(await readFile(file, 'utf8')) as { disabled: Record<string, boolean> }
    // 键被删掉，不是写成 false——缺键即开，写 false 会多出一种没人定义的状态。
    expect(Object.keys(document.disabled)).toEqual([])
  })

  it('does not bump the version when the value does not change', async () => {
    const store = createCoreIndicatorSourcePrefsStore(file)
    const key = coreIndicatorSourcePreferenceKey('US.CORE_PCE.NSA.YOY', 'fred-rates-liquidity')
    await store.setSourceEnabled(key, false)
    const first = JSON.parse(await readFile(file, 'utf8')) as { version: number }
    await store.setSourceEnabled(key, false)
    const second = JSON.parse(await readFile(file, 'utf8')) as { version: number }
    expect(second.version).toBe(first.version)
  })

  it('keeps an unreadable document from inventing a value', async () => {
    await writeFile(file, '{ not json', 'utf8')
    const store = createCoreIndicatorSourcePrefsStore(file)
    await expect(store.readDisabled()).resolves.toEqual({})
  })

  it('filters retired keys out before deciding whether an indicator still has a leg', () => {
    const live = ['US.CPI.NSA.YOY|narwhal', 'US.CPI.NSA.YOY|fred-rates-liquidity']
    const disabled = {
      'US.CPI.NSA.YOY|narwhal': true,
      // 退休源留下的记录：忽略它，别让死配置影响「这个指标还有没有腿」。
      'US.CPI.NSA.YOY|0xrouter': true
    }
    expect(enabledValueSources(live, disabled)).toEqual(['US.CPI.NSA.YOY|fred-rates-liquidity'])
  })
})
