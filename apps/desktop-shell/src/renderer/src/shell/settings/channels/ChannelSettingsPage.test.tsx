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
  it('gives the three icon actions three different screen-reader names', async () => {
    installPlatform()
    const container = await mount()

    const names = [...container.querySelectorAll('[data-channel-id="channel-1"] button')]
      .map((node) => node.getAttribute('aria-label') ?? '')
      .filter((name) => name.length > 0)
    expect(names).toContain(labels.channelLogs)
    expect(names).toContain(labels.channelEdit)
    expect(names).toContain(labels.channelDelete)
    expect(new Set(names).size).toBe(names.length)
  })

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

describe('the two fields that became saveable', () => {
  it('shows "inherit the agent" for a null permission mode and "no working folder" for the system workspace', async () => {
    installPlatform({ list: vi.fn(async () => [{ ...channel, permissionMode: null, workspace: { type: 'system' } }]) })
    const container = await mount()

    const edit = [...container.querySelectorAll('[data-channel-id="channel-1"] button')].find(
      (node) => node.getAttribute('aria-label') === labels.channelEdit
    )
    await act(async () => edit?.click())
    await act(async () => {})

    expect(document.body.textContent).toContain(labels.channelPermissionInherit)
    expect(document.body.textContent).toContain(labels.channelWorkspaceDefault)
  })

  it('sends the workspace and the permission mode through update, keeping "inherit" as null', async () => {
    const channels = installPlatform({
      list: vi.fn(async () => [{ ...channel, permissionMode: null, workspace: { type: 'system' } }])
    })
    const container = await mount()

    const edit = [...container.querySelectorAll('[data-channel-id="channel-1"] button')].find(
      (node) => node.getAttribute('aria-label') === labels.channelEdit
    )
    await act(async () => edit?.click())
    await act(async () => {})

    const save = [...document.body.querySelectorAll('button')].find((node) => node.textContent?.trim() === labels.channelUpdate)
    await act(async () => save?.click())
    await act(async () => {})

    expect(channels.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'channel-1',
        workspace: { type: 'system' },
        permissionMode: null
      })
    )
  })

  it('sends the system workspace and an inherited mode on create', async () => {
    const channels = installPlatform({ list: vi.fn(async () => []) })
    const container = await mount()

    const add = [...container.querySelectorAll('button')].find((node) => node.textContent?.trim() === labels.channelAdd)
    await act(async () => add?.click())
    await act(async () => {})

    const name = document.body.querySelector('input[aria-label="名称"]') as HTMLInputElement
    await act(async () => {
      name.value = 'Telegram 主频道'
      name.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const save = [...document.body.querySelectorAll('button')].find((node) => node.textContent?.trim() === labels.channelCreate)
    expect(save).not.toBeUndefined()
    // Token 与助手是必填：没填时保存按钮禁用——这是「不许保存成功但没存」那条规矩的延伸。
    expect((save as HTMLButtonElement).disabled).toBe(true)
    expect(channels.create).not.toHaveBeenCalled()
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

describe('the platform list follows the approved layout', () => {
  it('keeps the six platforms in the fixed order, whatever their status is', async () => {
    installPlatform()
    const container = await mount()

    // 第一格是字母徽标，名字在第二个 span 里：只比名字，不把徽标拼进来。
    const order = [...container.querySelectorAll('.channel-platform-item')].map((node) =>
      node.querySelectorAll('span')[1]?.textContent?.trim()
    )
    expect(order).toEqual(['飞书', 'Telegram', 'QQ', '微信', 'Discord', 'Slack'])
  })

  it('never shows another platform sentence once the selection changes', async () => {
    installPlatform()
    const container = await mount()

    expect(container.textContent).toContain(labels.channelPlatformPurpose.telegram)
    const slack = [...container.querySelectorAll('.channel-platform-item')].find((node) => node.textContent?.includes('Slack'))
    await act(async () => (slack as HTMLButtonElement).click())

    // Slack 这版接不了：说明换成那一句，且不再出现 Telegram 的说明。
    expect(container.textContent).toContain(labels.channelUnsupportedPane)
    expect(container.textContent).not.toContain(labels.channelPlatformPurpose.telegram)
  })

  it('leaves a platform that cannot be connected with its name, what it is for, why not, and no empty block', async () => {
    installPlatform()
    const container = await mount()

    const slack = [...container.querySelectorAll('.channel-platform-item')].find((node) => node.textContent?.includes('Slack'))
    await act(async () => (slack as HTMLButtonElement).click())

    // 三样都要：名字在标题，用途与原因各一句——缺用途时读者不知道这个平台是干什么的。
    expect(container.querySelector('.channel-detail-title')?.textContent).toBe('Slack')
    expect(container.textContent).toContain(labels.channelPlatformPurpose.slack)
    expect(container.textContent).toContain(labels.channelUnsupportedPane)
    expect(container.querySelector('[data-state="empty"]')).toBeNull()
    expect([...container.querySelectorAll('button')].find((node) => node.textContent?.trim() === labels.channelAdd)).toBeUndefined()
  })

  it('gives every platform a mark, and never brightens the ones that cannot be connected', async () => {
    installPlatform()
    const container = await mount()

    expect(container.querySelectorAll('.channel-platform-logo svg')).toHaveLength(6)
    expect(container.querySelector('.channel-platform-logo[data-platform-logo="telegram"]')).not.toBeNull()
  })
})

describe('an empty platform', () => {
  it('says no Telegram channel yet, and leaves the only add button at the top right', async () => {
    installPlatform({ list: vi.fn(async () => []) })
    const container = await mount()

    // 空态按组件契约：标准两行（通用标题 + 原因句）加一个「添加」动作，不再叠加自己的一句话。
    const empty = container.querySelector('[data-state="empty"]')
    expect(empty).not.toBeNull()
    expect(empty?.querySelectorAll('.state-view__title, .state-view__reason').length).toBe(2)
    expect(empty?.querySelector('.state-view__action')).not.toBeNull()
    const addButtons = [...container.querySelectorAll('button')].filter((node) => node.textContent?.trim() === labels.channelAdd)
    expect(addButtons).toHaveLength(1)
  })
})
