import { describe, expect, it, vi } from 'vitest'

import type { AssistantIpcPorts } from './assistantIpc'

const { registerAssistantIpc } = await import('./assistantIpc')

const EXPECTED_CHANNELS = [
  'platform:assistants-list',
  'platform:assistants-get',
  'platform:assistants-create',
  'platform:assistants-update',
  'platform:assistants-delete',
  'platform:assistants-reorder',
  'platform:assistants-library-list-templates',
  'platform:assistants-library-get-template',
  'platform:assistants-library-install-template',
  'platform:assistants-library-list-groups',
  'platform:assistants-library-create-assistant',
  'platform:assistants-list-topics',
  'platform:assistants-create-topic',
  'platform:assistants-update-topic',
  'platform:assistants-delete-topic',
  'platform:assistants-pin-topic',
  'platform:assistants-unpin-topic',
  'platform:assistants-list-topic-messages',
  'platform:assistants-set-active-node',
  'platform:assistants-rename-topic',
  'platform:assistants-create-message-sibling',
  'platform:assistants-edit-and-resend-user-message',
  'platform:assistants-clear-topic-messages',
  'platform:assistants-search-topic-messages',
  'platform:assistants-delete-message',
  'platform:assistants-stream-open',
  'platform:assistants-stream-attach',
  'platform:assistants-stream-abort',
  'platform:assistants-stream-get-status'
]

function record(): { channels: string[]; ipcMain: { handle: (channel: string, listener: unknown) => void } } {
  const channels: string[] = []
  return {
    channels,
    ipcMain: {
      handle: (channel: string) => {
        if (channels.includes(channel)) throw new Error(`duplicate channel: ${channel}`)
        channels.push(channel)
      }
    }
  }
}

function ports(overrides: Partial<AssistantIpcPorts> = {}) {
  const handlers = new Proxy(
    {},
    {
      get: (_target, key) => async (...args: unknown[]) => ({ method: String(key), args })
    }
  ) as never
  return {
    ports: {
      assistantIpcHandlers: handlers,
      getLanguage: async () => 'en-US',
      ...overrides
    } satisfies AssistantIpcPorts
  }
}

function listenersOf(given: AssistantIpcPorts) {
  const listeners = new Map<string, (...args: unknown[]) => unknown>()
  registerAssistantIpc(
    { handle: (channel: string, listener: (...args: unknown[]) => unknown) => listeners.set(channel, listener) } as never,
    given
  )
  return listeners
}

describe('assistant ipc surface', () => {
  it('registers exactly the twenty-nine assistant channels, in order', () => {
    const { channels, ipcMain } = record()
    registerAssistantIpc(ipcMain as never, ports().ports)

    expect(channels).toEqual(EXPECTED_CHANNELS)
  })

  it('keeps the snapshot in step with the module source', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('./assistantIpc.ts', import.meta.url), 'utf8')
    const referenced = [...source.matchAll(/IpcChannels\.(assistants\w+)/gu)].map((match) => match[1])

    const { IpcChannels } = await import('../../ipc/channels')
    const names = [...new Set(referenced)].map((key) => (IpcChannels as Record<string, string>)[key])
    expect(names.sort()).toEqual([...EXPECTED_CHANNELS].sort())
  })

  it('falls back to the current interface language for the four template handlers', async () => {
    const listeners = listenersOf(ports().ports)

    const listed = await listeners.get('platform:assistants-library-list-templates')!({}, undefined, undefined)
    expect(listed).toEqual({ method: 'listAssistantTemplates', args: [{}, 'en-US'] })

    const groups = await listeners.get('platform:assistants-library-list-groups')!({})
    expect(groups).toEqual({ method: 'listAssistantTemplateGroups', args: ['en-US'] })
  })

  it('passes the stream request through unchanged so the handler owns its validation', async () => {
    const listeners = listenersOf(ports().ports)
    const request = { topicId: 'topic-1', assistantId: 'assistant-1' }

    await expect(listeners.get('platform:assistants-stream-open')!({}, request)).resolves.toEqual({
      method: 'streamOpen',
      args: [request]
    })
  })
})
