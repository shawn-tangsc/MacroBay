import { describe, expect, it } from 'vitest'

import {
  classifyHttpFailure,
  isModelNotActivatedFailure,
  isModelRetiredFailure,
  isModelUnavailableFailure
} from './providerConnection'

/**
 * PLAT-66：模型生命周期失败（已下线 / 无可用渠道）。
 * 实测（七牛云）：HTTP 502 + `Model deepseek-v3 has been retired on 2026-10-09 and is no longer
 * available. Please use another model.` —— 原先把这句压成 `http_5xx`，用户只看到「HTTP 502」，
 * 读不出「该模型已下线」这个结论。
 */
const retiredMessage =
  'Model deepseek-v3 has been retired on 2026-10-09 and is no longer available. Please use another model.'

describe('PLAT-66 model lifecycle failures', () => {
  it('classifies a retired model above the generic 5xx bucket', () => {
    expect(classifyHttpFailure(502, retiredMessage)).toBe('model_retired')
    expect(classifyHttpFailure(400, 'this model has been retired')).toBe('model_retired')
    expect(classifyHttpFailure(400, 'deepseek-v2 is no longer available')).toBe('model_retired')
  })

  it('classifies the Chinese retired wording', () => {
    for (const message of ['该模型已下线，请更换模型', '该模型不再可用', '该模型已停止服务']) {
      expect(classifyHttpFailure(500, message), message).toBe('model_retired')
    }
  })

  it('classifies "no available channels" as model_unavailable instead of model_not_activated', () => {
    expect(classifyHttpFailure(400, 'no available channels for this model')).toBe('model_unavailable')
    expect(classifyHttpFailure(503, 'no available channel')).toBe('model_unavailable')
    expect(classifyHttpFailure(400, '该模型当前无可用渠道')).toBe('model_unavailable')
    expect(classifyHttpFailure(400, '模型没有可用渠道')).toBe('model_unavailable')
    // 未开通（需购买量包）与「无可用渠道」必须分开：前者是账号/计费，后者是渠道故障。
    expect(isModelUnavailableFailure('no available channels')).toBe(true)
    expect(isModelNotActivatedFailure('no available channels')).toBe(false)
  })

  it('keeps the not-activated wording as model_not_activated', () => {
    expect(classifyHttpFailure(500, '模型不可用，请开通模型或购买量包')).toBe('model_not_activated')
    expect(classifyHttpFailure(500, 'the model is not activated for this account')).toBe('model_not_activated')
    expect(isModelNotActivatedFailure('模型不可用，请开通模型或购买量包')).toBe(true)
    expect(isModelRetiredFailure('模型不可用')).toBe(false)
    expect(isModelUnavailableFailure('模型不可用')).toBe(false)
  })

  it('keeps the documented classification order in front of the lifecycle codes', () => {
    expect(classifyHttpFailure(429, retiredMessage)).toBe('rate_limited')
    expect(classifyHttpFailure(402, retiredMessage)).toBe('account_balance_insufficient')
    // 生命周期优先于状态码：502/500 不再吞掉可读结论。
    expect(classifyHttpFailure(401, retiredMessage)).toBe('model_retired')
    expect(classifyHttpFailure(500, 'no available channels')).toBe('model_unavailable')
  })

  it('does not regress the existing HTTP / protocol / model-not-found classification', () => {
    expect(classifyHttpFailure(401, 'invalid api key')).toBe('http_401')
    expect(classifyHttpFailure(403, 'forbidden')).toBe('http_403')
    expect(classifyHttpFailure(404, 'model gemini-x not found')).toBe('model_not_found')
    expect(classifyHttpFailure(404, 'no such endpoint')).toBe('http_404')
    expect(classifyHttpFailure(500, '模型下无渠道支持messages协议')).toBe('protocol_unsupported')
    expect(classifyHttpFailure(500, 'internal server error')).toBe('http_5xx')
    expect(classifyHttpFailure(418, 'teapot')).toBe('http_418')
  })
})
