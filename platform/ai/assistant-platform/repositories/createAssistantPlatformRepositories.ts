import type { AssistantPlatformDatabase } from '../db/createAssistantPlatformDatabase'
import { createAssistantRepository, type AssistantRepository } from './assistantRepository'
import {
  createAssistantTemplateInstallRepository,
  type AssistantTemplateInstallRepository
} from './assistantTemplateInstallRepository'
import { createMessageRepository, type MessageRepository } from './messageRepository'
import { createTopicRepository, type TopicRepository } from './topicRepository'

export type AssistantPlatformRepositories = {
  transact: <T>(callback: () => T) => T
  assistants: AssistantRepository
  templateInstalls: AssistantTemplateInstallRepository
  topics: TopicRepository
  messages: MessageRepository
}

export function createAssistantPlatformRepositories(
  db: AssistantPlatformDatabase
): AssistantPlatformRepositories {
  const topics = createTopicRepository(db)
  return {
    transact: db.transact,
    assistants: createAssistantRepository(db),
    templateInstalls: createAssistantTemplateInstallRepository(db),
    topics,
    messages: createMessageRepository(db, topics)
  }
}

export type { AssistantRepository, AssistantTemplateInstallRepository, TopicRepository, MessageRepository }
