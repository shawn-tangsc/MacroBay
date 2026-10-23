import { describe, expect, it } from 'vitest'

import {
  createRuntimeTextDataFromDescriptor,
  createRuntimeTextDescriptor,
  isRuntimeTextPart,
  resolveRuntimeText,
  resolveRuntimeTextPart,
  runtimeStatusText,
  runtimeTextKeys
} from './runtimeText'

describe('runtimeText', () => {
  it('creates descriptors with fallback text and optional params', () => {
    const descriptor = createRuntimeTextDescriptor(runtimeTextKeys.stopped, '已停止。', { reason: 'user' })
    expect(descriptor).toEqual({
      key: runtimeTextKeys.stopped,
      fallback: '已停止。',
      params: { reason: 'user' }
    })
  })

  it('stores runtime-text parts that keep fallback as searchable text', () => {
    const data = createRuntimeTextDataFromDescriptor(runtimeStatusText.connecting)
    expect(data.parts).toHaveLength(1)
    expect(isRuntimeTextPart(data.parts[0])).toBe(true)
    expect(data.parts[0]?.text).toBe('正在连接模型服务...')
    expect(data.parts[0]?.fallback).toBe('正在连接模型服务...')
  })

  it('resolves catalog entries and falls back when missing', () => {
    expect(resolveRuntimeText(runtimeStatusText.stopped)).toBe('已停止。')
    expect(
      resolveRuntimeText(runtimeStatusText.stopped, {
        [runtimeTextKeys.stopped]: 'Stopped.'
      })
    ).toBe('Stopped.')
    expect(
      resolveRuntimeTextPart(
        {
          type: 'runtime-text',
          key: runtimeTextKeys.connecting,
          fallback: '正在连接模型服务...',
          text: '正在连接模型服务...'
        },
        {
          [runtimeTextKeys.connecting]: 'Connecting to the model service...'
        }
      )
    ).toBe('Connecting to the model service...')
  })
})
