// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { platformText } from '../../../i18n/platformText'
import { ChannelSettingsPage } from './ChannelSettingsPage'

const labels = platformText['zh-CN'].settings
let root: Root | undefined

const catalogEntries = [
  { type: 'telegram', status: 'supported', reason: 'release-a-pending', implemented: true, credentialFields: ['bot_token'] },
  { type: 'feishu', status: 'blocked', reason: 'adapter-blocked', implemented: false, credentialFields: [] }
]

const channel = {
  id: 'channel-1',
  type: 'telegram',
  name: 'Telegram 2',
  agentId: 'agent-1',
  state: 'runtime-ready',
  credential: { status: 'configured', hasCredential: true }
}

function installPlatform(overrides: Record<string, unknown> = {}): Record<string, ReturnType<typeof vi.fn>> {
  const channels = {
    catalog: vi.fn(async () => catalogEntries),
    list: vi.fn(async () => [channel]),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    requestEnable: vi.fn(async () => ({})),
    disable: vi.fn(async () => ({})),
    remove: vi.fn(async () => ({})),
    ...overrides
  }
  Object.assign(globalThis, {
    window: Object.assign(globalThis.window, {
      platform: { channels, agents: { listAgents: vi.fn(async () => ({ agents: [{ id: 'agent-1', name: '助手一' }] })) } }
    })
  })
  return channels as unknown as Record<string, ReturnType<typeof vi.fn>>
}

function stateOf(container: HTMLElement, state: string): Element | null {
  return container.querySelector(`[data-state="${state}"]`)
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
  document.body.replaceChildren()
})

describe('reading the channel list', () => {
  it('surfaces a failed first read as an error with retry, never as "no channels"', async () => {
    installPlatform({ catalog: vi.fn(async () => { throw new Error('ipc-unavailable') }) })

    const container = await mount()

    expect(stateOf(container, 'error')).not.toBeNull()
    expect(stateOf(container, 'empty')).toBeNull()
    expect(container.textContent).not.toContain('暂无 Telegram 频道')
  })

  it('draws only loading before the first read returns', async () => {
    installPlatform({ catalog: vi.fn(() => new Promise(() => {})) })
    const container = await mount()

    expect(container.querySelector('.loading-state')).not.toBeNull()
    expect(stateOf(container, 'error')).toBeNull()
    expect(stateOf(container, 'empty')).toBeNull()
  })

  it('keeps the list and marks it stale when a later read fails', async () => {
    const channels = installPlatform()
    const container = await mount()
    expect(container.textContent).toContain(channel.name)

    // 任一动作之后都会重读一次列表；这一次读失败时，旧列表要留在屏幕上并标一句「上次读到的」。
    channels.list.mockRejectedValueOnce(new Error('ipc-unavailable'))
    const toggle = container.querySelector('[role="switch"]') as HTMLButtonElement
    await act(async () => toggle.click())
    await act(async () => {})

    expect(container.textContent).toContain(channel.name)
    expect(container.textContent).toContain(labels.channelStaleNotice)
    expect(stateOf(container, 'error')).toBeNull()
  })
})

describe('a channel row', () => {
  it('shows the name, an all-star token and the four row actions — with no way to reveal or copy it', async () => {
    installPlatform()
    const container = await mount()

    const row = container.querySelector('[data-channel-id="channel-1"]')
    expect(row).not.toBeNull()
    expect(row?.textContent).toContain(channel.name)
    expect(row?.textContent).toContain(labels.channelTokenMask)
    // 掩码只有星号：没有查看、没有复制，也没有任何按钮把真值带回来。
    const labelsOfRow = [...(row?.querySelectorAll('button') ?? [])].map((node) => node.getAttribute('aria-label') ?? '')
    expect(labelsOfRow).toContain(labels.channelLogs)
    expect(labelsOfRow).toContain(labels.channelEdit)
    expect(labelsOfRow).toContain(labels.channelDelete)
    for (const forbidden of ['查看', '复制', 'Reveal', 'Copy']) {
      expect(row?.textContent).not.toContain(forbidden)
    }
  })

  it('turns the switch off through disable, and on through requestEnable', async () => {
    const on = installPlatform()
    const container = await mount()
    const toggle = container.querySelector('[role="switch"]') as HTMLButtonElement | null
    expect(toggle).not.toBeNull()
    await act(async () => toggle?.click())
    expect(on.disable).toHaveBeenCalledWith({ id: 'channel-1', actorId: 'settings-user' })

    // 另一棵树：这条频道现在不在跑，拨上去就该是 requestEnable——两个方向各走各的 IPC，不是同一个。
    await act(async () => root?.unmount())
    document.body.replaceChildren()
    const off = installPlatform({ list: vi.fn(async () => [{ ...channel, state: 'disabled' }]) })
    const second = await mount()
    const offToggle = second.querySelector('[role="switch"]') as HTMLButtonElement
    await act(async () => offToggle.click())
    expect(off.requestEnable).toHaveBeenCalledWith({ id: 'channel-1', actorId: 'settings-user' })
  })

  it('says a channel whose credential cannot be read has an inline reason, not a panel', async () => {
    installPlatform({ list: vi.fn(async () => [{ ...channel, credential: { status: 'unavailable', hasCredential: true } }]) })
    const container = await mount()

    const row = container.querySelector('[data-channel-id="channel-1"]')
    expect(row?.textContent).toContain(labels.channelCredentialUnavailable)
  })
})

describe('platforms that are not implemented', () => {
  it('says only that this version cannot connect it, with no add button and no red copy', async () => {
    installPlatform()
    const container = await mount()

    const feishu = [...container.querySelectorAll('button')].find((node) => node.textContent?.includes(labels.channelPlatformName.feishu))
    await act(async () => feishu?.click())

    expect(container.textContent).toContain(labels.channelUnsupportedPane)
    const addButton = [...container.querySelectorAll('button')].find((node) => node.textContent?.trim() === labels.channelAdd)
    expect(addButton).toBeUndefined()
    expect(container.querySelector('.channel-row')).toBeNull()
  })
})

describe('an empty platform', () => {
  it('says no Telegram channel yet, and leaves the only add button at the top right', async () => {
    installPlatform({ list: vi.fn(async () => []) })
    const container = await mount()

    expect(container.textContent).toContain(labels.channelEmptyForPlatform.replace('{platform}', 'Telegram'))
    const addButtons = [...container.querySelectorAll('button')].filter((node) => node.textContent?.trim() === labels.channelAdd)
    expect(addButtons).toHaveLength(1)
  })
})
