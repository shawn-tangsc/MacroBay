// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { platformText } from '../../../i18n/platformText'
import { ChannelSettingsPage } from './ChannelSettingsPage'

const labels = platformText['zh-CN'].settings
let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const catalogEntries = [
  { type: 'telegram', status: 'planned', reason: 'release-a-pending', implemented: true, credentialFields: ['bot_token'] },
  { type: 'feishu', status: 'blocked', reason: 'adapter-blocked', implemented: false, credentialFields: [] }
]

function installPlatform(overrides: Record<string, unknown>): void {
  const channels = {
    catalog: vi.fn(async () => catalogEntries),
    list: vi.fn(async () => []),
    listPolicies: vi.fn(async () => []),
    listConversations: vi.fn(async () => []),
    listCandidates: vi.fn(async () => []),
    runtimeStatus: vi.fn(async () => null),
    ...overrides
  }
  Object.assign(globalThis, {
    window: Object.assign(globalThis.window, {
      platform: { channels, agents: { listAgents: vi.fn(async () => ({ agents: [] })) } }
    })
  })
}

async function mount(): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(createElement(ChannelSettingsPage, { language: 'zh-CN' })))
  await act(async () => {})
  return container
}

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
})

describe('ChannelSettingsPage read failures and catalog copy', () => {
  it('surfaces a failed first read instead of showing an empty panel', async () => {
    installPlatform({ catalog: vi.fn(async () => { throw new Error('ipc-unavailable') }) })

    const container = await mount()

    // Before this, a rejected read left an empty rail with no error and an unhandled rejection.
    expect(container.textContent).toContain(labels.channelOperationFailed)
  })

  it('names what each blocked adapter is missing', async () => {
    installPlatform({})

    const container = await mount()

    expect(container.textContent).toContain(labels.channelCatalogReason.planned)
    expect(container.textContent).toContain(labels.channelCatalogReason.blockedUnimplemented)
    expect(container.textContent).toContain('telegram')
  })
})

describe('empty rail state', () => {
  it('puts the caret in the first input when the reader takes the action', async () => {
    installPlatform({})
    const container = await mount()

    // The empty state names the action; taking it must land the caret in the form,
    // not merely scroll the reader near it.
    const action = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === '创建'
    )
    expect(action).toBeDefined()

    await act(async () => action?.click())

    const nameInput = container.querySelector('input[aria-label="名称"]')
    expect(nameInput).not.toBeNull()
    expect(document.activeElement).toBe(nameInput)
  })
})
