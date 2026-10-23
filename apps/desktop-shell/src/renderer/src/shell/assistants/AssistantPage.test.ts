import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { platformText } from '../../i18n/platformText'
import { resolveAssistantStreamErrorText } from './AssistantPage'
import { selectTopicAfterDeletion } from './assistantTopicSelection'

describe('AssistantPage stream scoping', () => {
  it('guards stream status updates so foreign topic executions do not hijack the active chat state', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell/assistants/AssistantPage.tsx'),
      'utf8'
    )

    expect(source).toMatch(/onStreamDone[\s\S]*topicId && topicId !== activeTopicId[\s\S]*return/)
    expect(source).toMatch(/onStreamError[\s\S]*topicId && topicId !== activeTopicId[\s\S]*return/)
    expect(source).toMatch(/onStreamStatusChanged[\s\S]*snapshot\.topicId !== activeTopicId[\s\S]*return/)
  })

  it('keeps assistant prompts out of the chat workspace chrome', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell/assistants/AssistantPage.tsx'),
      'utf8'
    )

    expect(source).not.toContain('AssistantPromptStrip')
  })

  it('keeps the active conversation when another topic is deleted and selects a neighbor for the deleted current topic', () => {
    const previousTopics = [{ id: 'first' }, { id: 'current' }, { id: 'other' }]

    expect(selectTopicAfterDeletion(previousTopics, [{ id: 'first' }, { id: 'current' }], 'other')).toBe('current')
    expect(selectTopicAfterDeletion(previousTopics, [{ id: 'first' }, { id: 'other' }], 'current')).toBe('other')
  })
})

describe('AssistantPage stream error text', () => {
  const labels = platformText['en-US'].assistants
  const fixtureKey = 'fixture-assistant-key-1234567890'
  const fixtureRef = 'fixture-assistant-ref-1234567890'
  const fixturePayload = 'fixture-assistant-payload-1234567890'

  it('maps the configuration-required code without rendering stream error details', () => {
    const resolved = resolveAssistantStreamErrorText({
      code: 'provider-configuration-required',
      message: `fixture-stream-message-${fixtureKey}`,
      apiKey: fixtureKey,
      apiKeyRef: fixtureRef,
      payload: fixturePayload
    }, labels)

    expect(resolved).toBe(labels.modelNotReady)
    expect(resolved).not.toContain(fixtureKey)
    expect(resolved).not.toContain(fixtureRef)
    expect(resolved).not.toContain(fixturePayload)
  })

  it('maps the request-failed code to the localized generic failure', () => {
    expect(resolveAssistantStreamErrorText({ code: 'provider-request-failed' }, labels))
      .toBe(labels.conversationOperationFailed)
  })

  it('maps model lifecycle codes to the real conclusion instead of "try again"', () => {
    expect(resolveAssistantStreamErrorText({ code: 'provider-model-retired' }, labels)).toBe(labels.modelRetired)
    expect(resolveAssistantStreamErrorText({ code: 'provider-model-not-activated' }, labels))
      .toBe(labels.modelNotActivated)
    expect(resolveAssistantStreamErrorText({ code: 'provider-model-not-found' }, labels)).toBe(labels.modelNotFound)
    // 真实结论里不带原始上游文案/Key。
    expect(labels.modelRetired).not.toContain(fixtureKey)
  })

  it('maps unknown stream error codes to the localized generic failure', () => {
    expect(resolveAssistantStreamErrorText({
      code: 'fixture-unknown-code',
      message: 'fixture-raw-stream-message'
    }, labels)).toBe(labels.conversationOperationFailed)
  })
})
