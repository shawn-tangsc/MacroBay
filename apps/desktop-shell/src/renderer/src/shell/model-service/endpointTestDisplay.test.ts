import { describe, expect, it } from 'vitest'

import { platformText } from '../../i18n/platformText'

import { describeEndpointProbe } from './endpointTestDisplay'

/** PLAT-63：端点探测判定 → 一句人话（行内结果与连接检查 lane 共用）。 */
const labels = platformText['en-US'].models
const zh = platformText['zh-CN'].models

describe('describeEndpointProbe', () => {
  it('labels a 2xx probe as available with a success tone and no detail', () => {
    const display = describeEndpointProbe({ verdict: 'available', status: 200, message: '' }, labels)

    expect(display.label).toBe(labels.endpointTestAvailable)
    expect(display.tone).toBe('success')
    expect(display.detail).toBeNull()
  })

  it('labels a 400/422 probe as an existing endpoint with a parameter problem', () => {
    const display = describeEndpointProbe(
      { verdict: 'exists_param_error', status: 422, message: 'HTTP 422 · messages: field required' },
      labels
    )

    expect(display.label).toBe(labels.endpointTestExistsParamError)
    expect(display.tone).toBe('warning')
    expect(display.detail).toBe('HTTP 422 · messages: field required')
  })

  it('labels auth failures, missing paths, unreachable hosts and unsupported probes', () => {
    expect(describeEndpointProbe({ verdict: 'exists_auth_failed', status: 401, message: '' }, labels).label)
      .toBe(labels.endpointTestExistsAuthFailed)
    expect(describeEndpointProbe({ verdict: 'missing', status: 404, message: '' }, labels).label)
      .toBe(labels.endpointTestMissing)
    expect(describeEndpointProbe({ verdict: 'unreachable', status: null, message: 'timeout' }, labels).label)
      .toBe(labels.endpointTestUnreachable)
    expect(describeEndpointProbe({ verdict: 'unsupported', status: null, message: '' }, labels))
      .toEqual({ tone: 'neutral', label: labels.endpointTestUnsupported, detail: null })
    expect(describeEndpointProbe({ verdict: 'no_model', status: null, message: '' }, labels).label)
      .toBe(labels.endpointTestNoModel)
  })

  it('uses the Chinese sentences and never appends a status code to the label itself', () => {
    const display = describeEndpointProbe({ verdict: 'missing', status: 405, message: '' }, zh)

    expect(display.label).toBe(zh.endpointTestMissing)
    expect(display.label).not.toContain('405')
    expect(display.label).toBe('路径不存在')
  })
})
