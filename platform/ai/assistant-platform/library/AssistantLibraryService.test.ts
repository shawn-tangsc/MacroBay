import { describe, expect, it } from 'vitest'

import { createAssistantPlatformDatabase } from '../db/createAssistantPlatformDatabase'
import { createAssistantPlatformRepositories } from '../repositories/createAssistantPlatformRepositories'
import { AssistantTemplateRegistry } from './AssistantTemplateRegistry'
import { AssistantLibraryService } from './AssistantLibraryService'

describe('AssistantLibraryService', () => {
  it('localizes and filters the catalog', () => {
    const { service } = createService()

    const writing = service.listTemplates({ search: 'write' }, 'en-US')

    expect(writing.map((item) => item.templateId)).toEqual(['platform:writing-assistant'])
    expect(writing[0]?.name).toBe('Writing Assistant')
  })

  it('returns full localized template detail for the detail dialog', () => {
    const { service } = createService()

    const detail = service.getTemplate('platform:writing-assistant', 'en-US')

    expect(detail).toMatchObject({
      templateId: 'platform:writing-assistant',
      name: 'Writing Assistant',
      prompt: 'Write clearly.'
    })
  })

  it('installs a template as an editable assistant with provenance', () => {
    const { service, repos, registry } = createService()

    const result = service.installTemplate({ templateId: 'platform:writing-assistant' }, 'en-US')
    repos.assistants.update(result.assistant.id, { prompt: 'User changed prompt.' })

    expect(result.assistant).toMatchObject({
      name: 'Writing Assistant',
      icon: '✍️',
      prompt: 'Write clearly.'
    })
    expect(repos.templateInstalls.getByAssistantId(result.assistant.id)).toMatchObject({
      sourceTemplateId: 'platform:writing-assistant',
      sourceTemplateVersion: 1
    })
    expect(registry.get('platform:writing-assistant')?.prompt['en-US']).toBe('Write clearly.')
  })

  it('rolls back assistant creation when provenance write fails', () => {
    const { service, repos } = createService({
      overrideTemplateInstalls: (templateInstalls) => ({
        ...templateInstalls,
        upsert() {
          throw new Error('provenance write failed')
        }
      })
    })

    expect(() => service.installTemplate({ templateId: 'platform:writing-assistant' }, 'en-US')).toThrow(
      'provenance write failed'
    )
    expect(repos.assistants.list()).toEqual([])
  })

  it('marks installed templates and update availability', () => {
    const { service, registry } = createService()
    service.installTemplate({ templateId: 'platform:writing-assistant' }, 'en-US')

    registry.clear()
    registry.register({
      templateId: 'writing-assistant',
      sourceKind: 'platform',
      version: 2,
      name: { 'zh-CN': '写作助手', 'en-US': 'Writing Assistant' },
      prompt: { 'zh-CN': '清晰写作。', 'en-US': 'Write clearly.' },
      groups: ['writing']
    })

    const item = service.getTemplate('platform:writing-assistant', 'en-US')

    expect(item).toMatchObject({
      installed: true,
      hasUpdate: true
    })
  })

  it('creates manual assistants without template provenance', () => {
    const { service, repos } = createService()

    const assistant = service.createAssistant({
      name: 'Manual',
      prompt: 'Manual prompt.',
      icon: '🧪',
      contextSourceIds: []
    })

    expect(assistant.name).toBe('Manual')
    expect(repos.templateInstalls.getByAssistantId(assistant.id)).toBeNull()
  })
})

function createService(options?: {
  overrideTemplateInstalls?: (
    templateInstalls: ReturnType<typeof createAssistantPlatformRepositories>['templateInstalls']
  ) => ReturnType<typeof createAssistantPlatformRepositories>['templateInstalls']
}) {
  const db = createAssistantPlatformDatabase(':memory:')
  const baseRepos = createAssistantPlatformRepositories(db)
  const repos = options?.overrideTemplateInstalls
    ? {
        ...baseRepos,
        templateInstalls: options.overrideTemplateInstalls(baseRepos.templateInstalls)
      }
    : baseRepos
  const registry = new AssistantTemplateRegistry()
  registry.registerMany([
    {
      templateId: 'default-assistant',
      sourceKind: 'platform',
      version: 1,
      name: { 'zh-CN': '默认助手', 'en-US': 'Default Assistant' },
      description: { 'zh-CN': '通用帮助', 'en-US': 'General help' },
      prompt: { 'zh-CN': '帮助用户。', 'en-US': 'Help the user.' },
      groups: ['general', 'featured']
    },
    {
      templateId: 'writing-assistant',
      sourceKind: 'platform',
      version: 1,
      name: { 'zh-CN': '写作助手', 'en-US': 'Writing Assistant' },
      description: { 'zh-CN': '写作', 'en-US': 'Writing' },
      icon: '✍️',
      prompt: { 'zh-CN': '清晰写作。', 'en-US': 'Write clearly.' },
      groups: ['writing'],
      tags: [{ 'zh-CN': '写作', 'en-US': 'Writing' }]
    }
  ])
  const service = new AssistantLibraryService({ registry, repos })
  return { service, repos, registry }
}
