import { describe, expect, it } from 'vitest'

import { createAssistantPlatformDatabase } from '../db/createAssistantPlatformDatabase'
import { createAssistantPlatformRepositories } from './createAssistantPlatformRepositories'

describe('assistantTemplateInstallRepository', () => {
  it('upserts and lists provenance records by source template', () => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    const assistant = repos.assistants.create({ name: 'Installed' })

    const record = repos.templateInstalls.upsert({
      assistantId: assistant.id,
      sourceKind: 'platform',
      sourceProductId: null,
      sourceTemplateId: 'platform:default-assistant',
      sourceTemplateVersion: 1,
      promptHashAtInstall: 'hash-a'
    })

    expect(record.installedAt).toBeTruthy()
    expect(repos.templateInstalls.getByAssistantId(assistant.id)).toMatchObject({
      assistantId: assistant.id,
      sourceTemplateId: 'platform:default-assistant',
      promptHashAtInstall: 'hash-a'
    })
    expect(repos.templateInstalls.listBySource('platform:default-assistant')).toHaveLength(1)
  })

  it('deletes provenance when the assistant is deleted', () => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    const assistant = repos.assistants.create({ name: 'Installed' })
    repos.templateInstalls.upsert({
      assistantId: assistant.id,
      sourceKind: 'platform',
      sourceProductId: null,
      sourceTemplateId: 'platform:default-assistant',
      sourceTemplateVersion: 1,
      promptHashAtInstall: 'hash-a'
    })

    repos.assistants.delete(assistant.id)

    expect(repos.templateInstalls.getByAssistantId(assistant.id)).toBeNull()
  })
})
