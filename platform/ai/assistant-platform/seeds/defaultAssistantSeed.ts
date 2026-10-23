import type { AppLanguage } from '@platform/settings/schema/appSettings'

import { DEFAULT_ASSISTANT_ID, createDefaultAssistantSettings } from '../schemas/assistantSchemas'
import type { AssistantEntity } from '../schemas/assistantSchemas'

const DEFAULT_ASSISTANT_COPY: Record<AppLanguage, Pick<AssistantEntity, 'name' | 'prompt' | 'description'>> = {
  'zh-CN': {
    name: '默认助手',
    prompt: '你是一个乐于助人的助手。',
    description: '平台默认普通聊天助手。'
  },
  'en-US': {
    name: 'Default Assistant',
    prompt: 'You are a helpful assistant.',
    description: 'Platform default assistant for ordinary chat.'
  }
}

export function resolveDefaultAssistantCopy(
  language: AppLanguage
): Pick<AssistantEntity, 'name' | 'prompt' | 'description'> {
  return DEFAULT_ASSISTANT_COPY[language] ?? DEFAULT_ASSISTANT_COPY['en-US']
}

export function buildDefaultAssistantLocalizationPatch(
  assistant: Pick<AssistantEntity, 'id' | 'name' | 'prompt' | 'description'>,
  language: AppLanguage
): Pick<AssistantEntity, 'name' | 'prompt' | 'description'> | null {
  if (assistant.id !== DEFAULT_ASSISTANT_ID) return null

  const matchesBuiltinCopy = Object.values(DEFAULT_ASSISTANT_COPY).some(
    (copy) =>
      assistant.name === copy.name &&
      assistant.prompt === copy.prompt &&
      assistant.description === copy.description
  )
  if (!matchesBuiltinCopy) return null

  const localizedCopy = resolveDefaultAssistantCopy(language)
  if (
    assistant.name === localizedCopy.name &&
    assistant.prompt === localizedCopy.prompt &&
    assistant.description === localizedCopy.description
  ) {
    return null
  }

  return localizedCopy
}

export function createDefaultAssistantSeed(input?: { now?: Date; language?: AppLanguage }): AssistantEntity {
  const now = input?.now ?? new Date()
  const language = input?.language ?? 'en-US'
  const timestamp = now.toISOString()
  const copy = resolveDefaultAssistantCopy(language)
  return {
    id: DEFAULT_ASSISTANT_ID,
    name: copy.name,
    prompt: copy.prompt,
    icon: '💬',
    description: copy.description,
    settings: createDefaultAssistantSettings(),
    modelId: null,
    modelName: null,
    mcpServerIds: [],
    contextSourceIds: [],
    tags: [],
    orderKey: '0001',
    createdAt: timestamp,
    updatedAt: timestamp
  }
}
