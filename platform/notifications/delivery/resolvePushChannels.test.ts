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

  it('counts requested channels from their intent, never from the state histogram', () => {
    // `configuration-ready` 同时装两种处境：刚建好（没请求启用）与「启用过、围栏保留意图」。
    // 按档反推会把前者算成「请求过」——这条用例就是把那种假阳性钉死。
    expect(resolvePushChannels([
      { id: 'a', name: 'A', state: 'configuration-ready', requestedEnabled: true },
      { id: 'b', name: 'B', state: 'configuration-ready', requestedEnabled: false },
      { id: 'c', name: 'C', state: 'credential-missing', requestedEnabled: false }
    ])).toEqual({
      ok: false,
      reason: 'push-unavailable',
      enabledChannelCount: 0,
      states: { 'configuration-ready': 2, 'credential-missing': 1 },
      requestedCount: 1
    })

    // 没有开启意图的字段（老调用点）不许凭空算成「请求过」。
    expect(resolvePushChannels([{ id: 'a', name: 'A', state: 'configuration-ready' }]))
      .toMatchObject({ requestedCount: 0 })
  })

  it('fails closed with zero ready channels and reports the state histogram', () => {
    expect(resolvePushChannels([
      { id: 'a', name: 'A', state: 'credential-missing' },
      { id: 'b', name: 'B', state: 'disabled' }
    ])).toEqual({
      ok: false,
      reason: 'push-unavailable',
      enabledChannelCount: 0,
      states: { 'credential-missing': 1, disabled: 1 },
      requestedCount: 0
    })
    // 一条都没有：空直方图也是「没有」，不是「不知道」。
    expect(resolvePushChannels([])).toEqual({ ok: false, reason: 'push-unavailable', enabledChannelCount: 0, states: {}, requestedCount: 0 })
  })
})
