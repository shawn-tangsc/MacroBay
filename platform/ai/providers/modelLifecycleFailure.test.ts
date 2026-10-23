import { describe, expect, it } from 'vitest'

import {
  classifyModelLifecycleFailure,
  modelLifecycleRuntimeFailureCode,
  resolveProviderRuntimeFailureCode
} from './modelLifecycleFailure'
import { ChatProtocolFailureError } from '../chat/chatProtocolFailure'
import { ProviderRuntimeFailureError, ProviderRuntimeFailurePolicy } from './modelProviderTypes'

/**
 * PLAT-74：四类模型生命周期失败必须各自判对；其它失败一律不许被误判（否则「请重试」
 * 会被错翻成「换模型」）。
 */
describe('PLAT-74 model lifecycle failure classification', () => {
  it('classifies retired / no-longer-available as model-retired', () => {
    expect(classifyModelLifecycleFailure({
      status: 502,
      summary: 'Model deepseek-v3 has been retired on 2026-10-09 and is no longer available.'
    })).toBe('model-retired')
    expect(classifyModelLifecycleFailure({
      status: 404,
      summary: 'This model is no longer available.'
    })).toBe('model-retired')
  })

  it('classifies model_not_activated as model-not-activated', () => {
    expect(classifyModelLifecycleFailure({
      status: 400,
      summary: 'Access denied: model_not_activated'
    })).toBe('model-not-activated')
    expect(classifyModelLifecycleFailure({
      status: 403,
      summary: '该模型未开通，请先购买量包'
    })).toBe('model-not-activated')
  })

  it('classifies a bare 404 as model-not-found', () => {
    expect(classifyModelLifecycleFailure({ status: 404, summary: 'Not Found' })).toBe('model-not-found')
    expect(classifyModelLifecycleFailure({
      status: 400,
      summary: 'The model does not exist for this account.'
    })).toBe('model-not-found')
  })

  it('stays null for unrelated failures so the generic fallback is kept', () => {
    expect(classifyModelLifecycleFailure({ status: 401, summary: 'invalid api key' })).toBeNull()
    expect(classifyModelLifecycleFailure({ status: 429, summary: 'rate limit exceeded' })).toBeNull()
    expect(classifyModelLifecycleFailure({ status: 500, summary: 'internal server error' })).toBeNull()
    expect(classifyModelLifecycleFailure({ summary: 'fetch failed' })).toBeNull()
    expect(classifyModelLifecycleFailure({})).toBeNull()
  })

  it('maps each lifecycle result to its stable runtime code', () => {
    expect(modelLifecycleRuntimeFailureCode('model-retired')).toBe(ProviderRuntimeFailurePolicy.modelRetired)
    expect(modelLifecycleRuntimeFailureCode('model-not-activated')).toBe(ProviderRuntimeFailurePolicy.modelNotActivated)
    expect(modelLifecycleRuntimeFailureCode('model-not-found')).toBe(ProviderRuntimeFailurePolicy.modelNotFound)
  })

  it('reads evidence off the adapter failure types and keeps the existing fallbacks', () => {
    const retired = new ChatProtocolFailureError({
      phase: 'response',
      summary: 'The model has been retired.',
      httpStatus: 404
    })
    expect(resolveProviderRuntimeFailureCode(retired)).toBe(ProviderRuntimeFailurePolicy.modelRetired)

    // 无 Key / 网络 / 配置类错误不受影响：仍是既有兜底。
    expect(resolveProviderRuntimeFailureCode(
      new ProviderRuntimeFailureError(ProviderRuntimeFailurePolicy.configurationRequired)
    )).toBe(ProviderRuntimeFailurePolicy.configurationRequired)
    expect(resolveProviderRuntimeFailureCode(new Error('fetch failed'))).toBe(ProviderRuntimeFailurePolicy.requestFailed)
    expect(resolveProviderRuntimeFailureCode(
      new ChatProtocolFailureError({ phase: 'request', summary: 'fetch failed' })
    )).toBe(ProviderRuntimeFailurePolicy.requestFailed)
  })
})
