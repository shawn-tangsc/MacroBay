import { describe, expect, it } from 'vitest'

import {
  assistantTemplateGroupIds,
  normalizeAssistantTemplateRegistration,
  validateAssistantTemplateRegistration
} from './assistantTemplateSchemas'

describe('assistantTemplateSchemas', () => {
  it('exposes group ids', () => {
    expect(assistantTemplateGroupIds).toContain('mine')
    expect(assistantTemplateGroupIds).toContain('featured')
    expect(assistantTemplateGroupIds).toContain('programming')
    expect(assistantTemplateGroupIds).toContain('translation')
  })

  it('defaults missing groups and install policy for valid registrations', () => {
    const normalized = normalizeAssistantTemplateRegistration({
      templateId: 'platform:default-assistant',
      sourceKind: 'platform',
      version: 1,
      name: { 'zh-CN': '默认助手', 'en-US': 'Default Assistant' },
      prompt: { 'zh-CN': '帮助用户。', 'en-US': 'Help the user.' },
      groups: []
    })

    expect(normalized.groups).toEqual(['general'])
    expect(normalized.installPolicy).toBe('library-only')
  })

  it('requires localized name and prompt text', () => {
    expect(() =>
      validateAssistantTemplateRegistration({
        templateId: 'platform:broken',
        sourceKind: 'platform',
        version: 1,
        name: { 'zh-CN': '缺英文', 'en-US': '' },
        prompt: { 'zh-CN': '提示词', 'en-US': 'Prompt' },
        groups: ['general']
      })
    ).toThrow(/name/)

    expect(() =>
      validateAssistantTemplateRegistration({
        templateId: 'platform:broken',
        sourceKind: 'platform',
        version: 1,
        name: { 'zh-CN': '名称', 'en-US': 'Name' },
        prompt: { 'zh-CN': '', 'en-US': 'Prompt' },
        groups: ['general']
      })
    ).toThrow(/prompt/)
  })

  it('rejects invalid versions and unknown group ids', () => {
    const valid = {
      templateId: 'platform:default-assistant',
      sourceKind: 'platform' as const,
      version: 1,
      name: { 'zh-CN': '默认助手', 'en-US': 'Default Assistant' },
      prompt: { 'zh-CN': '帮助用户。', 'en-US': 'Help the user.' },
      groups: ['general' as const]
    }

    expect(() => validateAssistantTemplateRegistration({ ...valid, version: 0 })).toThrow(/version/)
    expect(() =>
      validateAssistantTemplateRegistration({ ...valid, groups: ['unsupported'] as never })
    ).toThrow(/group/)
  })
})
