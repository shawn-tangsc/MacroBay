import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ASSISTANT_ID,
  DEFAULT_ASSISTANT_SETTINGS,
  createDefaultAssistantSettings,
  isAssistantMcpMode,
  normalizeAssistantSettings
} from './assistantSchemas'

describe('assistantSchemas', () => {
  it('exposes stable default assistant id and settings', () => {
    expect(DEFAULT_ASSISTANT_ID).toBe('default')
    expect(DEFAULT_ASSISTANT_SETTINGS.streamOutput).toBe(true)
    expect(DEFAULT_ASSISTANT_SETTINGS.mcpMode).toBe('disabled')
    expect(createDefaultAssistantSettings()).toEqual(DEFAULT_ASSISTANT_SETTINGS)
  })

  it('normalizes partial settings and rejects invalid mcp modes', () => {
    expect(isAssistantMcpMode('auto')).toBe(true)
    expect(isAssistantMcpMode('weird')).toBe(false)
    expect(
      normalizeAssistantSettings({
        temperature: 0.4,
        enableTemperature: true,
        mcpMode: 'manual',
        customParameters: [{ name: 'foo', type: 'string', value: 'bar' }]
      })
    ).toMatchObject({
      temperature: 0.4,
      enableTemperature: true,
      mcpMode: 'manual',
      streamOutput: true,
      customParameters: [{ name: 'foo', type: 'string', value: 'bar' }]
    })
    expect(() => normalizeAssistantSettings({ mcpMode: 'weird' as never })).toThrow(/mcpMode/)
  })
})
