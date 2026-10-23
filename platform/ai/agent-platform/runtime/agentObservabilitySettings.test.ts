import { describe, expect, it } from 'vitest'

import {
  createDefaultAgentObservabilitySettings,
  normalizeAgentObservabilitySettings,
  shouldEnableLocalOtlpBridge,
  shouldExportRemoteOtlp
} from './agentObservabilitySettings'

describe('agentObservabilitySettings', () => {
  it('defaults to console export without prompt or tool content', () => {
    expect(createDefaultAgentObservabilitySettings()).toEqual({
      exporterMode: 'console',
      remoteEndpoint: '',
      includePrompts: false,
      includeToolContent: false
    })
  })

  it('normalizes unknown values back to safe defaults', () => {
    expect(
      normalizeAgentObservabilitySettings({
        exporterMode: 'remote-otlp',
        remoteEndpoint: ' https://collector.example/v1/traces ',
        includePrompts: true,
        includeToolContent: 'yes'
      })
    ).toEqual({
      exporterMode: 'remote-otlp',
      remoteEndpoint: 'https://collector.example/v1/traces',
      includePrompts: true,
      includeToolContent: false
    })

    expect(normalizeAgentObservabilitySettings({ exporterMode: 'disk' })).toEqual(
      createDefaultAgentObservabilitySettings()
    )
  })

  it('gates local bridge and remote export modes', () => {
    expect(shouldEnableLocalOtlpBridge({ ...createDefaultAgentObservabilitySettings(), exporterMode: 'local-otlp' })).toBe(
      true
    )
    expect(shouldExportRemoteOtlp({ ...createDefaultAgentObservabilitySettings(), exporterMode: 'remote-otlp' })).toBe(
      false
    )
    expect(
      shouldExportRemoteOtlp({
        ...createDefaultAgentObservabilitySettings(),
        exporterMode: 'remote-otlp',
        remoteEndpoint: 'https://collector.example/v1/traces'
      })
    ).toBe(true)
  })
})
