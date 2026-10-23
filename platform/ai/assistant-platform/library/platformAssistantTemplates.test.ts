import { describe, expect, it } from 'vitest'

import { AssistantTemplateRegistry } from './AssistantTemplateRegistry'
import { platformAssistantTemplates } from './platformAssistantTemplates'

describe('platformAssistantTemplates', () => {
  it('provides a small generic built-in catalog', () => {
    expect(platformAssistantTemplates.map((template) => template.templateId)).toEqual(['default-assistant'])
  })

  it('validates through the template registry', () => {
    const registry = new AssistantTemplateRegistry()

    registry.registerMany(platformAssistantTemplates)

    expect(registry.list()).toHaveLength(1)
    expect(registry.get('platform:default-assistant')?.sourceKind).toBe('platform')
  })

  it('keeps platform built-ins product-neutral', () => {
    const forbidden = /Binance|MACD|订单流|交易复盘|crypto|trading|market-intelligence/i
    const text = JSON.stringify(platformAssistantTemplates)

    expect(text).not.toMatch(forbidden)
  })
})
