import { describe, expect, it } from 'vitest'

import { resolvePushChannels } from './pushChannelResolution'

/**
 * 多通道（方案 §5-1）：`runtime-ready` 有几条就返回几条，**不再有「恰好一条」这一档**。
 *
 * 判据只有一条（`state === 'runtime-ready'`），与旧单数版本是同一个判据——所以两个函数在同一份文件里，
 * 不许在调用处再拼一次「requestedEnabled && credential.status」。
 * 用户 2026-11-12 拍板：多条同时启用是合法状态，**不是配置冲突**，所以这里不产生任何诊断码。
 */
const ready = (id: string): { id: string; name: string; state: string } => ({ id, name: id.toUpperCase(), state: 'runtime-ready' })

describe('resolvePushChannels', () => {
  it('returns every runtime-ready channel in projection order', () => {
    expect(resolvePushChannels([
      ready('a'),
      { id: 'b', name: 'B', state: 'credential-missing' },
      ready('c')
    ])).toEqual({ ok: true, channels: [{ id: 'a', name: 'A' }, { id: 'c', name: 'C' }] })
  })

  it('keeps one channel working exactly as before', () => {
    expect(resolvePushChannels([ready('a')])).toEqual({ ok: true, channels: [{ id: 'a', name: 'A' }] })
  })

  it('fails closed with zero ready channels and reports the state histogram', () => {
    expect(resolvePushChannels([
      { id: 'a', name: 'A', state: 'credential-missing' },
      { id: 'b', name: 'B', state: 'disabled' }
    ])).toEqual({
      ok: false,
      reason: 'push-unavailable',
      enabledChannelCount: 0,
      states: { 'credential-missing': 1, disabled: 1 }
    })
    // 一条都没有：空直方图也是「没有」，不是「不知道」。
    expect(resolvePushChannels([])).toEqual({ ok: false, reason: 'push-unavailable', enabledChannelCount: 0, states: {} })
  })
})
