// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { ToastHost } from '@platform/ui/components/toast'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { platformText } from '../../../i18n/platformText'
import { CHANNEL_DISPLAY_NAME } from '@platform/channels/channelDisplayNames'
import { ChannelSettingsPage } from './ChannelSettingsPage'

const labels = platformText['zh-CN'].settings
let root: Root | undefined

const catalogEntries = [
  { type: 'telegram', status: 'supported', reason: 'release-a-pending', implemented: true, credentialFields: ['bot_token'] },
  { type: 'slack', status: 'blocked', reason: 'adapter-blocked', implemented: true, credentialFields: ['bot_token', 'app_token'] },
  { type: 'discord', status: 'blocked', reason: 'adapter-blocked', implemented: true, credentialFields: ['bot_token'] },
  { type: 'qq', status: 'blocked', reason: 'adapter-blocked', implemented: true, credentialFields: ['app_id', 'client_secret'] },
  { type: 'feishu', status: 'blocked', reason: 'adapter-blocked', implemented: true, credentialFields: ['app_id', 'app_secret'] },
  // 没实现的平台目录里仍有一行，但**列表里不出现**：列表回答的是「我现在能用哪个」。
  { type: 'wechat', status: 'blocked', reason: 'adapter-blocked', implemented: false, credentialFields: [] }
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
    // 保存后回读用的就是这一口：默认「已配置」，只有需要演「没存上」的用例才覆盖它。
    get: vi.fn(async () => ({ ...channel, id: 'channel-1' })),
    create: vi.fn(async () => ({ ok: true, code: 'configuration-ready', channel: { id: 'channel-1' } })),
    update: vi.fn(async () => ({ ok: true, code: 'updated' })),
    requestEnable: vi.fn(async () => ({ ok: true, code: 'runtime-ready' })),
    disable: vi.fn(async () => ({ ok: true, code: 'disabled' })),
    remove: vi.fn(async () => ({ ok: true, code: 'deleted' })),
    listPolicies: vi.fn(async () => []),
    beginCredential: vi.fn(async () => ({ sessionId: 's', mainPublicJwk: {} })),
    submitCredential: vi.fn(async () => ({})),
    sendTestMessage: vi.fn(async () => ({ state: 'accepted', messageId: 'm-1' })),
    // 行内「查看会话」只问一件事：这条频道有没有绑定过会话。默认没有——出现按钮的用例自己覆盖。
    listConversations: vi.fn(async () => []),
    // 「打开这条对话的会话」由主进程自己查会话 id、自己选中，渲染层只发频道 id + 对话 id。
    openConversation: vi.fn(async () => ({ ok: true })),
    rotateCredential: vi.fn(async () => ({ ok: true, code: 'configuration-ready' })),
    ...overrides
  }
  Object.assign(globalThis, {
    window: Object.assign(globalThis.window, {
      platform: {
        channels,
        agents: {
          listAgents: vi.fn(async () => ({ agents: [{ id: 'agent-1', name: '助手一' }] })),
          // 工作目录下拉的真实来源：整份智能体状态里的工作区。
          getState: vi.fn(async () => ({
            workspaces: [
              { id: 'ws-1', name: 'market-notes', path: '/Users/me/market-notes', type: 'user', orderKey: 'a' },
              { id: 'ws-system', name: 'System', path: '/Users/me/Library/app', type: 'system', orderKey: 'b' }
            ]
          })),
          ensureWorkspace: vi.fn(async (path: string) => ({ ok: true, workspace: { id: 'ws-new', name: '新目录', path } })),
          // 「查看会话」只做两件事：选中这条频道绑定的助手，然后落到智能体页。
          selectAgent: vi.fn(async () => ({}))
        },
        app: { selectDirectory: vi.fn(async () => '/Users/me/new-folder') }
      }
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
  await act(async () => root?.render(createElement(ToastHost, null, createElement(ChannelSettingsPage, { language: 'zh-CN' }))))
  await act(async () => {})
  return container
}

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

/**
 * 选中一项之后，等选择框真的把这一项显示出来——等条件，不等一个宏任务。
 * 失败信息带上等的是哪个值，免得「下拉没关」和「值没选上」分不清。
 */
async function waitForSelection(label: string): Promise<void> {
  await vi.waitFor(() => {
    const shown = [...document.querySelectorAll('.ant-select-selection-item')]
    expect(shown.some((node) => node.textContent?.trim() === label), `selection ${label}`).toBe(true)
  })
}

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
    expect(on.disable).toHaveBeenCalledWith({ channelId: 'channel-1', actorId: 'settings-user' })

    // 另一棵树：这条频道现在不在跑，拨上去就该是 requestEnable——两个方向各走各的 IPC，不是同一个。
    await act(async () => root?.unmount())
    document.body.replaceChildren()
    const off = installPlatform({ list: vi.fn(async () => [{ ...channel, state: 'disabled' }]) })
    const second = await mount()
    const offToggle = second.querySelector('[role="switch"]') as HTMLButtonElement
    await act(async () => offToggle.click())
    expect(off.requestEnable).toHaveBeenCalledWith({ channelId: 'channel-1', actorId: 'settings-user' })
  })

  it('says a stored-but-unreadable credential is not the same as having none', async () => {
    installPlatform({
      list: vi.fn(async () => [{ ...channel, credential: { status: 'unavailable', hasCredential: true, revision: 1 } }])
    })
    const container = await mount()

    const row = container.querySelector('[data-channel-id="channel-1"]')
    // 存过但读不出来：说这一句。
    expect(row?.textContent).toContain(labels.channelTokenUnavailable)
    // **不许**再说「还没有 Token」——今天两个相反的结论同屏，就是另一种假话。
    expect(row?.textContent).not.toContain(labels.channelTokenNone)
    // 也不画星号：星号会被读成「有值但看不见」。
    expect(row?.textContent).not.toContain(labels.channelTokenMask.trim())
  })
})

/**
 * 判据变了（2026-11-10）：工作目录与权限模式这两栏撤掉之后，这一屏只回答两件事——
 * 「这条频道是什么」+「开不开」。原来那三条用例问的是「这两样能不能保存」；现在问的是
 * **「有没有第二个权威」**：弹层里不许再出现这两个控件，保存也不许把这两样交给接口。
 */
describe('the channel dialog has one authority for permission and working folder', () => {
  /** 有标签外壳的那两项（名称与智能体是裸输入，没有 FieldShell）。 */
  const labelledFields = (): string[] =>
    [...document.body.querySelectorAll('.channel-field-label')].map((node) => node.textContent?.trim() ?? '')
  /** 弹层里还剩几个下拉：工作目录与权限模式都曾是 Select，只留「绑定智能体」那一个。 */
  const selects = (): number => document.body.querySelectorAll('.ant-select').length

  async function openEditor(): Promise<void> {
    const container = await mount()
    const edit = [...container.querySelectorAll('[data-channel-id="channel-1"] button')].find(
      (node): node is HTMLButtonElement => node.getAttribute('aria-label') === labels.channelEdit
    )
    await act(async () => edit?.click())
    await act(async () => {})
  }

  it('offers exactly four fields when editing, and sends neither field to the interface', async () => {
    const channels = installPlatform({
      list: vi.fn(async () => [{ ...channel, permissionMode: 'acceptEdits', workspace: { type: 'user', workspaceId: 'ws-1' } }])
    })
    await openEditor()

    // 字段清单**恰好**是这些：多一项就是又开始收集第二个答案了。
    expect(labelledFields()).toEqual([labels.channelCredential, labels.channelFieldAllowedChats])
    // 只剩「绑定智能体」一个下拉：工作目录与权限模式原本各是 Select。
    expect(selects()).toBe(1)

    const save = [...document.body.querySelectorAll('button')].find(
      (node): node is HTMLButtonElement => node.textContent?.trim() === labels.channelUpdate
    )
    await act(async () => save?.click())
    await act(async () => {})

    const payload = channels.update.mock.calls[0]?.[0] as Record<string, unknown> | undefined
    expect(payload).toBeDefined()
    // 逐键比对：多出 workspace / permissionMode 就是把第二个权威又交回去了。
    expect(Object.keys(payload ?? {}).sort()).toEqual(['actorId', 'agentId', 'allowedChatIds', 'id', 'name'])
  })

  it('offers the same four fields when creating', async () => {
    const channels = installPlatform({ list: vi.fn(async () => []) })
    const container = await mount()

    const add = [...container.querySelectorAll('button')].find((node) => node.textContent?.trim() === labels.channelAdd)
    await act(async () => add?.click())
    await act(async () => {})

    expect(labelledFields()).toEqual([labels.channelCredential, labels.channelFieldAllowedChats])
    expect(selects()).toBe(1)
    // 两个入口同一套字段：新建这条路径也不该带上那两样。
    expect(channels.create).not.toHaveBeenCalled()
  })
})

describe('replacing the token without revealing it', () => {
  it('starts a credential handoff only when a new token is typed', async () => {
    const channels = installPlatform({ list: vi.fn(async () => [{ ...channel, allowedChatIds: [] }]) })
    const container = await mount()
    const edit = [...container.querySelectorAll('[data-channel-id="channel-1"] button')].find(
      (node): node is HTMLButtonElement => node.getAttribute('aria-label') === labels.channelEdit
    )
    await act(async () => edit?.click())
    await act(async () => {})

    const field = document.body.querySelector('input[aria-label="Bot Token"]') as HTMLInputElement
    expect(field).not.toBeNull()
    // 旧值不被回显：输入框永远是空的。
    expect(field.value).toBe('')
    expect(field.getAttribute('type')).toBe('password')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(field, '123:new-token')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const save = [...document.body.querySelectorAll('button')].find(
      (node): node is HTMLButtonElement => node.textContent?.trim() === labels.channelUpdate
    )
    await act(async () => save?.click())
    await act(async () => {})

    // 真实加密要 WebCrypto（happy-dom 没有 subtle），所以这里证明「替换路径被走到」：
    // 一旦输入新值，页面就会去取交接材料；空值时不会（见下一条）。
    expect(channels.beginCredential).toHaveBeenCalledWith({ channelId: 'channel-1' })
    expect(channels.update).toHaveBeenCalled()
  })

  it('leaves the credential alone when the field stays empty', async () => {
    const channels = installPlatform({ list: vi.fn(async () => [{ ...channel, allowedChatIds: [] }]) })
    const container = await mount()
    const edit = [...container.querySelectorAll('[data-channel-id="channel-1"] button')].find(
      (node): node is HTMLButtonElement => node.getAttribute('aria-label') === labels.channelEdit
    )
    await act(async () => edit?.click())
    await act(async () => {})
    const save = [...document.body.querySelectorAll('button')].find(
      (node): node is HTMLButtonElement => node.textContent?.trim() === labels.channelUpdate
    )
    await act(async () => save?.click())
    await act(async () => {})

    expect(channels.beginCredential).not.toHaveBeenCalled()
    expect(channels.update).toHaveBeenCalled()
  })
})

describe('showing which token is stored', () => {
  it('shows the main-process mask on the row and in the dialog, with the last update', async () => {
    installPlatform({
      list: vi.fn(async () => [
        {
          ...channel,
          allowedChatIds: [],
          credential: { status: 'configured', hasCredential: true, revision: 3, maskedFields: { bot_token: '6050…xAA' } }
        }
      ])
    })
    const container = await mount()

    // 列表行直接显示主进程给的掩码（不是渲染层自己切）。
    expect(container.querySelector('[data-channel-id="channel-1"] .channel-row-mask')?.textContent).toBe('6050…xAA')

    const edit = [...container.querySelectorAll('[data-channel-id="channel-1"] button')].find(
      (node): node is HTMLButtonElement => node.getAttribute('aria-label') === labels.channelEdit
    )
    await act(async () => edit?.click())
    await act(async () => {})

    const current = document.body.querySelector('[data-current-token]')
    expect(current?.textContent).toContain('6050…xAA')
    // 不显示「最近更新」：安全视图没有凭据时间戳，拿频道更新时间冒充它是说假话。
    expect(current?.textContent).not.toContain('最近更新')
    // 第二条凭据是「第 N 次保存」，不是时间。
    expect(current?.textContent).toContain('第 3 次保存')
    // 输入框仍为空：旧值不被回显。
    const field = document.body.querySelector('input[aria-label="Bot Token"]') as HTMLInputElement
    expect(field.value).toBe('')
  })
})

describe('an empty credential is said out loud, never dressed as a mask', () => {
  it('writes "no token yet" on the row instead of stars that read like a stored value', async () => {
    installPlatform({
      list: vi.fn(async () => [
        { ...channel, allowedChatIds: [], credential: { status: 'missing', hasCredential: false } }
      ])
    })
    const container = await mount()

    const row = container.querySelector('[data-channel-id="channel-1"]')
    expect(row?.textContent).toContain(labels.channelTokenNone)
    // 星号会被读成「有值但看不见」——用户正是看到它才以为「我明明设了」。
    expect(row?.querySelector('.channel-row-mask')?.textContent).not.toContain(labels.channelTokenMask.trim())
  })

  it('says a stored token cannot be read, instead of saying nothing is stored', async () => {
    installPlatform({
      list: vi.fn(async () => [
        {
          ...channel,
          allowedChatIds: [],
          credential: { status: 'unavailable', hasCredential: true, revision: 1 }
        }
      ])
    })
    const container = await mount()
    const edit = [...container.querySelectorAll('[data-channel-id="channel-1"] button')].find(
      (node): node is HTMLButtonElement => node.getAttribute('aria-label') === labels.channelEdit
    )
    await act(async () => edit?.click())
    await act(async () => {})

    const current = document.body.querySelector('[data-current-token]')
    expect(current?.textContent).toContain(labels.channelTokenUnavailable)
    // 同一屏里不许同时出现相反的结论。
    expect(current?.textContent).not.toContain(labels.channelTokenCurrentNone)
    expect(current?.textContent).not.toContain('当前已存')
    // 提示也跟着档位走：这一档是「填一把新的换掉它」，不是「留空＝不修改」。
    expect(document.body.textContent).toContain(labels.channelTokenUnavailableHint)
    expect(document.body.textContent).not.toContain(labels.channelTokenReadOnly)
  })

  it('does not say "currently stored" in the dialog when nothing is stored, and asks for a token', async () => {
    installPlatform({
      list: vi.fn(async () => [
        { ...channel, allowedChatIds: [], credential: { status: 'missing', hasCredential: false } }
      ])
    })
    const container = await mount()
    const edit = [...container.querySelectorAll('[data-channel-id="channel-1"] button')].find(
      (node): node is HTMLButtonElement => node.getAttribute('aria-label') === labels.channelEdit
    )
    await act(async () => edit?.click())
    await act(async () => {})

    const current = document.body.querySelector('[data-current-token]')
    expect(current?.textContent).toContain(labels.channelTokenCurrentNone)
    expect(current?.textContent).not.toContain('当前已存')
    // 「留空＝不修改」在这里是假话：本来就没有可改的值。
    expect(document.body.textContent).toContain(labels.channelTokenEnterHint)
    expect(document.body.textContent).not.toContain(labels.channelTokenReadOnly)
    // 也没有「第 N 次保存」：从没保存过凭据。
    expect(current?.textContent).not.toContain('次保存')
  })
})

describe('the allowed chat IDs field', () => {
  it('says the bot is open to everyone when the list is empty and no policy exists', async () => {
    installPlatform({ list: vi.fn(async () => [{ ...channel, allowedChatIds: [] }]) })
    const container = await mount()
    await openEdit(container)
    await act(async () => {})

    const status = document.body.querySelector('[data-allowed-chats-status]')
    expect(status?.getAttribute('data-allowed-chats-status')).toBe('none')
    expect(status?.textContent).toContain(labels.channelAllowedChatsAll)
    expect(status?.textContent).toContain(labels.channelAllowedChatsRisk)
  })

  it('does not claim everyone is allowed when the channel already has an explicit policy', async () => {
    installPlatform({
      list: vi.fn(async () => [{ ...channel, allowedChatIds: [] }]),
      listPolicies: vi.fn(async () => [{ id: 'policy-1' }])
    })
    const container = await mount()
    await openEdit(container)
    await act(async () => {})

    const status = document.body.querySelector('[data-allowed-chats-status]')
    expect(status?.getAttribute('data-allowed-chats-status')).toBe('present')
    expect(status?.textContent).toContain(labels.channelAllowedChatsPolicies)
    expect(status?.textContent).not.toContain(labels.channelAllowedChatsAll)
  })

  it('writes the parsed list back through update', async () => {
    const channels = installPlatform({ list: vi.fn(async () => [{ ...channel, allowedChatIds: [] }]) })
    const container = await mount()
    await openEdit(container)
    await act(async () => {})

    // 用文案键取，不写死一句话：字段名换成读者的话时，这条用例不该跟着改。
    const field = document.body.querySelector(`textarea[aria-label="${labels.channelFieldAllowedChats}"]`) as HTMLTextAreaElement
    await act(async () => {
      // React 会拦截直接赋值：走原型上的 setter，它才认这次变更。
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(field, '111, 222\n333')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const save = [...document.body.querySelectorAll('button')].find(
      (node): node is HTMLButtonElement => node.textContent?.trim() === labels.channelUpdate
    )
    await act(async () => save?.click())
    await act(async () => {})

    expect(channels.update).toHaveBeenCalledWith(expect.objectContaining({ allowedChatIds: ['111', '222', '333'] }))
  })

  async function openEdit(container: HTMLElement): Promise<void> {
    const edit = [...container.querySelectorAll('[data-channel-id="channel-1"] button')].find(
      (node): node is HTMLButtonElement => node.getAttribute('aria-label') === labels.channelEdit
    )
    await act(async () => edit?.click())
  }
})

describe('enabling a channel runs a live check', () => {
  it('reports the check failure in the row, in plain words, and leaves the switch off', async () => {
    const channels = installPlatform({
      list: vi.fn(async () => [{ ...channel, state: 'disabled', allowedChatIds: [] }]),
      requestEnable: vi.fn(async () => ({ ok: false, code: 'channel-smoke-failed', reason: 'telegram-conflict' }))
    })
    const container = await mount()
    const toggle = container.querySelector('[role="switch"]') as HTMLButtonElement
    await act(async () => toggle.click())
    await act(async () => {})

    expect(channels.requestEnable).toHaveBeenCalledWith({ channelId: 'channel-1', actorId: 'settings-user' })
    const failure = container.querySelector('[data-enable-failure]')
    expect(failure?.textContent).toContain('另一个程序也在用这个机器人')
    // 不出现内部码，也不让开关假装打开。
    expect(container.textContent).not.toContain('channel-smoke-failed')
    expect(container.textContent).not.toContain('telegram-conflict')
  })

  it('clears the failure sentence once a later enable passes', async () => {
    const channels = installPlatform({
      list: vi.fn(async () => [{ ...channel, state: 'disabled', allowedChatIds: [] }]),
      requestEnable: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, code: 'channel-smoke-failed', reason: 'telegram-network-unavailable' })
        .mockResolvedValue({ ok: true, code: 'runtime-ready' })
    })
    const container = await mount()
    const toggle = container.querySelector('[role="switch"]') as HTMLButtonElement
    await act(async () => toggle.click())
    await act(async () => {})
    expect(container.querySelector('[data-enable-failure]')).not.toBeNull()

    channels.list.mockResolvedValue([{ ...channel, state: 'disabled', allowedChatIds: [] }])
    await act(async () => (container.querySelector('[role="switch"]') as HTMLButtonElement).click())
    await act(async () => {})

    expect(container.querySelector('[data-enable-failure]')).toBeNull()
  })

  it('does not require an acceptance record before the platform can be used', async () => {
    installPlatform({
      catalog: vi.fn(async () => [
        { type: 'telegram', status: 'planned', reason: 'release-a-pending', implemented: true, credentialFields: ['bot_token'] }
      ]),
      list: vi.fn(async () => [{ ...channel, state: 'disabled', allowedChatIds: [] }])
    })
    const container = await mount()

    // planned（还没有真机验收）仍然能看到「＋ 添加」与频道行，不再被证据门槛挡住。
    expect([...container.querySelectorAll('button')].some((node) => node.textContent?.trim() === labels.channelAdd)).toBe(true)
    expect(container.querySelector('[data-channel-id="channel-1"]')).not.toBeNull()
  })
})

describe('the platform list follows the approved layout', () => {
  it('lists only the platforms this version can actually connect, in the fixed order', async () => {
    installPlatform()
    const container = await mount()

    // 第一格是字母徽标，名字在第二个 span 里：只比名字，不把徽标拼进来。
    const order = [...container.querySelectorAll('.channel-platform-item')].map((node) =>
      node.querySelectorAll('span')[1]?.textContent?.trim()
    )
    // 判据来自目录的 `implemented`：接上了才出现；微信没实现，所以不在列表里。
    expect(order).toEqual(['Telegram', 'Slack', 'Discord', 'QQ', '飞书'])
    expect(container.textContent).not.toContain('WeChat')
  })

  it('never shows another platform sentence once the selection changes', async () => {
    installPlatform()
    const container = await mount()

    expect(container.textContent).toContain(labels.channelPlatformPurpose.telegram)
    const slack = [...container.querySelectorAll('.channel-platform-item')].find((node) => node.textContent?.includes('Slack'))
    await act(async () => (slack as HTMLButtonElement).click())

    // 选中项换了，说明跟着换：不再出现 Telegram 那句。
    expect(container.textContent).toContain(labels.channelPlatformPurpose.slack)
    expect(container.textContent).not.toContain(labels.channelPlatformPurpose.telegram)
  })

  it('does not list a platform the catalog has not implemented', async () => {
    installPlatform()
    const container = await mount()

    // 微信目录里有行、但 implemented=false：列表里一个位置都不占，也不留空块或按不动的项。
    expect(container.textContent).not.toContain('WeChat')
    expect([...container.querySelectorAll('.channel-platform-item')]).toHaveLength(5)
    expect(container.querySelector('[data-state="empty"]')).toBeNull()
  })

  it('gives every listed platform its own mark', async () => {
    installPlatform()
    const container = await mount()

    // 每个列出来的平台都有自己的图形；Discord 接上之后也在。
    expect(container.querySelectorAll('.channel-platform-logo svg')).toHaveLength(5)
    for (const platform of ['telegram', 'slack', 'discord', 'qq', 'feishu']) {
      expect(container.querySelector(`.channel-platform-logo[data-platform-logo="${platform}"]`)).not.toBeNull()
    }
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

/**
 * 保存凭据必须自证。
 *
 * 用户上一次的现场是：填了 Token、界面没报错、他以为存上了，而库里 `credential_health` 一直是
 * `missing`——点启用时才变成「没得检查」。所以这里钉三件事：回读没配置就不许报成功、本来就
 * 没有凭据时留空保存必须明说「需要填一个」、回读确实配置了才算成功。
 */
describe('saving a credential has to prove itself', () => {
  /** happy-dom 没有 SubtleCrypto；这里只要让加密交接能跑完，验的是交接之后那次回读。 */
  function stubWebCrypto(): void {
    vi.stubGlobal('crypto', {
      getRandomValues: (array: Uint8Array) => array,
      subtle: {
        deriveBits: vi.fn(async () => new ArrayBuffer(32)),
        encrypt: vi.fn(async () => new ArrayBuffer(4)),
        exportKey: vi.fn(async () => ({})),
        generateKey: vi.fn(async () => ({ privateKey: {}, publicKey: {} })),
        importKey: vi.fn(async () => ({}))
      }
    })
  }

  function typeInto(field: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }

  async function openEdit(container: HTMLElement): Promise<void> {
    const edit = [...container.querySelectorAll('[data-channel-id="channel-1"] button')].find(
      (node): node is HTMLButtonElement => node.getAttribute('aria-label') === labels.channelEdit
    )
    await act(async () => edit?.click())
    await act(async () => {})
  }

  async function clickByText(label: string): Promise<void> {
    const button = [...document.body.querySelectorAll('button')].find(
      (node): node is HTMLButtonElement => node.textContent?.trim() === label
    )
    await act(async () => button?.click())
    await act(async () => {})
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports a save that did not land, keeps the dialog open and keeps what the user typed', async () => {
    stubWebCrypto()
    const channels = installPlatform({
      list: vi.fn(async () => [{ ...channel, allowedChatIds: [] }]),
      // 回读说：库里还是 missing。界面不许把这当成保存成功。
      get: vi.fn(async () => ({ ...channel, credential: { status: 'missing', hasCredential: false } }))
    })
    const container = await mount()
    await openEdit(container)

    const field = document.body.querySelector('input[aria-label="Bot Token"]') as HTMLInputElement
    await act(async () => typeInto(field, '123:new-token'))
    await clickByText(labels.channelUpdate)

    expect(channels.rotateCredential).toHaveBeenCalled()
    const error = document.body.querySelector('[data-channel-save-error]')
    expect(error?.textContent).toContain(labels.channelCredentialSaveFailed)
    // 弹层没关：没有假装成功。
    expect(document.body.querySelector('[data-current-token]')).not.toBeNull()
    // 用户粘的内容还在，不用重打一遍。
    expect((document.body.querySelector('input[aria-label="Bot Token"]') as HTMLInputElement).value).toBe('123:new-token')
  })

  it('does not mistake the old credential for a successful replacement', async () => {
    stubWebCrypto()
    installPlatform({
      list: vi.fn(async () => [{ ...channel, allowedChatIds: [] }]),
      // 写接口明确失败，但库里那条**旧**凭据还在：只看回读会读到 configured，于是错报成功。
      rotateCredential: vi.fn(async () => ({ ok: false, code: 'channel-credential-invalid' }))
    })
    const container = await mount()
    await openEdit(container)

    const field = document.body.querySelector('input[aria-label="Bot Token"]') as HTMLInputElement
    await act(async () => typeInto(field, '123:new-token'))
    await clickByText(labels.channelUpdate)

    // 写接口带码失败：说这个码的人话，不用「没存上，请重试」盖掉原因。
    expect(document.body.querySelector('[data-channel-save-error]')?.textContent).toContain(
      labels.channelFailureReason['channel-credential-invalid']
    )
    expect(document.body.querySelector('[data-current-token]')).not.toBeNull()
  })

  it('refuses to call an empty box saved when the channel never had a token', async () => {
    const channels = installPlatform({
      list: vi.fn(async () => [{ ...channel, allowedChatIds: [], credential: { status: 'missing', hasCredential: false } }]),
      get: vi.fn(async () => ({ ...channel, credential: { status: 'missing', hasCredential: false } }))
    })
    const container = await mount()
    await openEdit(container)

    await clickByText(labels.channelUpdate)

    expect(channels.update).toHaveBeenCalled()
    // 留空＝不改，但库里本来就没有：这不算成功，得说清「需要填一个」。
    expect(document.body.querySelector('[data-channel-save-error]')?.textContent).toContain(labels.channelCredentialRequired)
    expect(document.body.querySelector('[data-current-token]')).not.toBeNull()
  })

  it('closes the dialog once the read-back says configured', async () => {
    stubWebCrypto()
    installPlatform({ list: vi.fn(async () => [{ ...channel, allowedChatIds: [] }]) })
    const container = await mount()
    await openEdit(container)

    const field = document.body.querySelector('input[aria-label="Bot Token"]') as HTMLInputElement
    await act(async () => typeInto(field, '123:new-token'))
    await clickByText(labels.channelUpdate)

    expect(document.body.querySelector('[data-channel-save-error]')).toBeNull()
    expect(document.body.querySelector('[data-current-token]')).toBeNull()
  })

  it('tells the user the channel exists but the token did not land, instead of a silent success', async () => {
    stubWebCrypto()
    const channels = installPlatform({
      list: vi.fn(async () => []),
      create: vi.fn(async () => ({ ok: true, code: 'configuration-ready', channel: { id: 'channel-9' } })),
      get: vi.fn(async () => ({ ...channel, id: 'channel-9', credential: { status: 'missing', hasCredential: false } }))
    })
    const container = await mount()

    const add = [...container.querySelectorAll('button')].find((node) => node.textContent?.trim() === labels.channelAdd)
    await act(async () => add?.click())
    await act(async () => {})

    const name = document.body.querySelector('input[aria-label="名称"]') as HTMLInputElement
    await act(async () => typeInto(name, 'Telegram 9'))
    // 助手是必填：不选它，「创建」按钮一直是禁用的。
    const select = document.body.querySelector('.ant-select') as HTMLElement
    const trigger = select.querySelector('.ant-select-selector') ?? select
    await act(async () => trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    await vi.waitFor(() => {
      const options = [...document.querySelectorAll('.ant-select-item-option')]
      expect(options.some((option) => option.textContent?.trim() === '助手一')).toBe(true)
    })
    const option = [...document.querySelectorAll('.ant-select-item-option')].find(
      (node) => node.textContent?.trim() === '助手一'
    ) as HTMLElement
    await act(async () => {
      option.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    // 选完之后等选择框真的显示这一项，而不是等一个宏任务。
    await waitForSelection('助手一')
    const token = document.body.querySelector('input[aria-label="Bot Token"]') as HTMLInputElement
    await act(async () => typeInto(token, '123:new-token'))
    await clickByText(labels.channelCreate)

    expect(channels.create).toHaveBeenCalled()
    expect(channels.submitCredential).toHaveBeenCalled()
    // 建好了但 Token 没落库：页面级那句必须说清「频道已建好、Token 要重填」。
    expect(container.textContent).toContain(labels.channelCreatedWithoutCredential)
    expect(document.body.querySelector('[data-current-token]')).toBeNull()
  })
})

/**
 * 新建的返回形状是 `{ ok, code, channel }`，id 在 `channel.id` 里。
 *
 * 上一版按 `{ id }` 取顶层，于是「真的建成了」也被判成「操作失败，请重试」；用户再点一次
 * 就又建一条——用户库里那 8 条重复频道就是这么来的。这两条用例把「读到 id 就继续」和
 * 「失败要说人话、且不许再提交凭据」钉住。
 */
describe('creating a channel reads the real result', () => {
  function stubWebCrypto(): void {
    vi.stubGlobal('crypto', {
      getRandomValues: (array: Uint8Array) => array,
      subtle: {
        deriveBits: vi.fn(async () => new ArrayBuffer(32)),
        encrypt: vi.fn(async () => new ArrayBuffer(4)),
        exportKey: vi.fn(async () => ({})),
        generateKey: vi.fn(async () => ({ privateKey: {}, publicKey: {} })),
        importKey: vi.fn(async () => ({}))
      }
    })
  }

  function typeInto(field: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }

  /** 走完新建弹层：名称 + 助手 + Token，然后点「创建频道」。 */
  async function fillCreateDialog(container: HTMLElement): Promise<void> {
    const add = [...container.querySelectorAll('button')].find((node) => node.textContent?.trim() === labels.channelAdd)
    await act(async () => add?.click())
    await act(async () => {})

    const name = document.body.querySelector('input[aria-label="名称"]') as HTMLInputElement
    await act(async () => typeInto(name, 'Telegram 9'))

    const select = document.body.querySelector('.ant-select') as HTMLElement
    const trigger = select.querySelector('.ant-select-selector') ?? select
    await act(async () => trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    await vi.waitFor(() => {
      const options = [...document.querySelectorAll('.ant-select-item-option')]
      expect(options.some((option) => option.textContent?.trim() === '助手一')).toBe(true)
    })
    const option = [...document.querySelectorAll('.ant-select-item-option')].find(
      (node) => node.textContent?.trim() === '助手一'
    ) as HTMLElement
    await act(async () => {
      option.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const token = document.body.querySelector('input[aria-label="Bot Token"]') as HTMLInputElement
    await act(async () => typeInto(token, '123:new-token'))

    const submit = [...document.body.querySelectorAll('button')].find(
      (node): node is HTMLButtonElement => node.textContent?.trim() === labels.channelCreate
    )
    await act(async () => submit?.click())
    await act(async () => {})
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('takes the id from channel.id and keeps going instead of reporting a failure', async () => {
    stubWebCrypto()
    const channels = installPlatform({
      list: vi.fn(async () => []),
      create: vi.fn(async () => ({ ok: true, code: 'configuration-ready', channel: { id: 'channel-9' } })),
      get: vi.fn(async () => ({
        ...channel,
        id: 'channel-9',
        credential: { status: 'configured', hasCredential: true, maskedFields: { bot_token: '6050…xAA' } }
      }))
    })
    const container = await mount()
    await fillCreateDialog(container)

    expect(channels.submitCredential).toHaveBeenCalledWith(expect.objectContaining({ channelId: 'channel-9' }))
    // 建成了就不该出现「操作失败」。
    expect(container.textContent).not.toContain(labels.channelOperationFailed)
    expect(container.textContent).not.toContain(labels.channelOperationFailedUnknown)
  })

  it('names the failure code in plain words and stops before submitting a credential', async () => {
    stubWebCrypto()
    const channels = installPlatform({
      list: vi.fn(async () => []),
      create: vi.fn(async () => ({ ok: false, code: 'channel-agent-missing' }))
    })
    const container = await mount()
    await fillCreateDialog(container)

    expect(channels.submitCredential).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain(labels.channelFailureReason['channel-agent-missing'])
    // 不许出现内部码，也不许一律「操作失败，请重试」。
    expect(document.body.textContent).not.toContain('channel-agent-missing')
  })

  it('reports a failed delete in plain words instead of pretending the row is gone', async () => {
    const channels = installPlatform({
      list: vi.fn(async () => [{ ...channel, allowedChatIds: [] }]),
      remove: vi.fn(async () => ({ ok: false, code: 'channel-not-found' }))
    })
    const container = await mount()
    const remove = [...container.querySelectorAll('[data-channel-id="channel-1"] button')].find(
      (node): node is HTMLButtonElement => node.getAttribute('aria-label') === labels.channelDelete
    )
    await act(async () => remove?.click())
    await act(async () => {})
    const confirm = [...document.body.querySelectorAll('button')].find(
      (node): node is HTMLButtonElement => node.textContent?.trim() === labels.channelDelete && node.closest('[role="dialog"]') !== null
    ) as HTMLButtonElement | undefined
    await act(async () => (confirm ?? [...document.body.querySelectorAll('button')].pop())?.click())
    await act(async () => {})

    expect(channels.remove).toHaveBeenCalled()
    expect(container.textContent).toContain(labels.channelFailureReason['channel-not-found'])
  })
})

/**
 * 正在输入的新 Token 必须能被核对（用户原话：「看不了我设置了啥」）。
 *
 * 只有**输进去的那个值**可以临时看一眼；已存的旧值没有回显路径，也没有复制入口——
 * 那个开关不碰旧值，接口里也没有旧值可碰。
 */
describe('the token you are typing can be checked', () => {
  async function openEditDialog(container: HTMLElement): Promise<void> {
    const edit = [...container.querySelectorAll('[data-channel-id="channel-1"] button')].find(
      (node): node is HTMLButtonElement => node.getAttribute('aria-label') === labels.channelEdit
    )
    await act(async () => edit?.click())
    await act(async () => {})
  }

  it('switches between dots and readable text, with a reminder while it is readable', async () => {
    installPlatform({
      list: vi.fn(async () => [
        { ...channel, allowedChatIds: [], credential: { status: 'configured', hasCredential: true, revision: 1 } }
      ])
    })
    const container = await mount()
    await openEditDialog(container)

    const field = document.body.querySelector('input[aria-label="Bot Token"]') as HTMLInputElement
    expect(field.getAttribute('type')).toBe('password')
    expect(document.body.querySelector('[data-token-visible-hint]')).toBeNull()

    const toggle = [...document.body.querySelectorAll('button')].find(
      (node) => node.getAttribute('aria-label') === labels.channelTokenVisibility
    ) as HTMLButtonElement
    await act(async () => toggle.click())
    expect((document.body.querySelector('input[aria-label="Bot Token"]') as HTMLInputElement).getAttribute('type')).toBe('text')
    expect(document.body.querySelector('[data-token-visible-hint]')?.textContent).toBe(labels.channelTokenVisibleHint)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')

    await act(async () => toggle.click())
    expect((document.body.querySelector('input[aria-label="Bot Token"]') as HTMLInputElement).getAttribute('type')).toBe('password')
    expect(document.body.querySelector('[data-token-visible-hint]')).toBeNull()
  })
})

/**
 * 选择文件夹这条路已经跟着控件一起撤掉：这一屏不该再调系统目录窗口，也不该登记工作区。
 * 留一条反向证据，免得哪天有人把那一栏又接回来——那会是第二个工作区权威。
 */
describe('the channel screen no longer picks a working folder', () => {
  it('never opens the system folder picker nor registers a workspace', async () => {
    installPlatform({ list: vi.fn(async () => [{ ...channel, workspace: { type: 'user', workspaceId: 'ws-1' } }]) })
    const container = await mount()

    const add = [...container.querySelectorAll('button')].find((node) => node.textContent?.trim() === labels.channelAdd)
    await act(async () => add?.click())
    await act(async () => {})

    const agentsBridge = window.platform.agents as unknown as { ensureWorkspace: ReturnType<typeof vi.fn> }
    const appBridge = window.platform.app as unknown as { selectDirectory: ReturnType<typeof vi.fn> }
    expect(appBridge.selectDirectory).not.toHaveBeenCalled()
    expect(agentsBridge.ensureWorkspace).not.toHaveBeenCalled()
  })
})

/**
 * 「发送测试消息」是这一版「发」的入口，**不许是假按钮**：真调 IPC，回执三态就地显示，
 * 一条都不许写成「已送达」（我们只能证明通道接受了，证明不了手机显示了）。
 */
describe('sending a test message from the row', () => {
  function testButton(container: HTMLElement): HTMLButtonElement {
    return [...container.querySelectorAll('button')].find(
      (node) => node.textContent?.trim() === labels.channelTestSend
    ) as HTMLButtonElement
  }

  it('really calls the channel send, names who it went to, and claims nothing more', async () => {
    const channels = installPlatform({
      list: vi.fn(async () => [{ ...channel, allowedChatIds: [] }]),
      sendTestMessage: vi.fn(async () => ({ state: 'accepted', messageId: 'm-1', targetName: 'Telegram · 贾维斯' }))
    })
    const container = await mount()
    await act(async () => testButton(container).click())
    await act(async () => {})

    expect(channels.sendTestMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'channel-1', text: labels.channelTestMessageBody })
    )
    // 整句完全相等：换了措辞必须回来改用例，不能放宽成「包含‘发给’」。
    expect(container.querySelector('[data-test-receipt]')?.textContent).toBe(
      labels.channelTestAccepted.replace('{target}', 'Telegram · 贾维斯')
    )
    // 不许出现「已送达」这种我们证明不了的话。
    const accepted = container.querySelector('[data-test-receipt]')?.textContent ?? ''
    expect(accepted).not.toContain('送达')
    // 也不许再挂免责长句：只说发了没、发给谁。
    expect(accepted).not.toContain('确认不了')
    expect(accepted).toBe('已发给 Telegram · 贾维斯')
  })

  it('falls back to the platform name when the conversation name is unknown, and never prints an id', async () => {
    installPlatform({
      list: vi.fn(async () => [{ ...channel, allowedChatIds: [] }]),
      sendTestMessage: vi.fn(async () => ({ state: 'accepted', messageId: 'm-1', targetName: null }))
    })
    const container = await mount()
    await act(async () => testButton(container).click())
    await act(async () => {})

    const receipt = container.querySelector('[data-test-receipt]')?.textContent ?? ''
    expect(receipt).toBe(labels.channelTestAccepted.replace('{target}', CHANNEL_DISPLAY_NAME.telegram['zh-CN']))
    // 不许编名字，也不许把 chat_id / 频道 id 拼进来。
    expect(receipt).not.toContain('channel-1')
    expect(receipt).not.toMatch(/-?\d{6,}/u)
  })

  it('says who an unconfirmed send went to, and still not that it arrived', async () => {
    installPlatform({
      list: vi.fn(async () => [{ ...channel, allowedChatIds: [] }]),
      sendTestMessage: vi.fn(async () => ({ state: 'unconfirmed', messageId: 'm-2', targetName: 'Telegram · 8768' }))
    })
    const container = await mount()
    await act(async () => testButton(container).click())
    await act(async () => {})

    const receipt = container.querySelector('[data-test-receipt]')?.textContent ?? ''
    expect(receipt).toBe('已发给 Telegram · 8768，未拿到回执')
    expect(receipt).not.toContain('送达')
    expect(receipt).not.toContain('可能收到')
  })

  it('points at enabling when the channel is not running instead of pretending', async () => {
    installPlatform({
      list: vi.fn(async () => [{ ...channel, state: 'disabled', allowedChatIds: [] }]),
      sendTestMessage: vi.fn(async () => ({ state: 'failed', reason: 'not-ready' }))
    })
    const container = await mount()
    await act(async () => testButton(container).click())
    await act(async () => {})

    expect(container.querySelector('[data-test-receipt]')?.textContent).toBe(labels.channelTestNotReady)
  })

  it('points at something the reader can actually do when no conversation is known yet', async () => {
    installPlatform({
      list: vi.fn(async () => [{ ...channel, allowedChatIds: [] }]),
      sendTestMessage: vi.fn(async () => ({ state: 'failed', reason: 'no-target' }))
    })
    const container = await mount()
    await act(async () => testButton(container).click())
    await act(async () => {})

    const receipt = container.querySelector('[data-test-receipt]')?.textContent ?? ''
    expect(receipt).toBe(labels.channelTestNoTarget)
    // 界面上没有「绑定」入口：这句话不许再把人指到那里。
    expect(receipt).not.toContain('绑定')
    // 真实的下一步要写出来：先在手机上发一条，入站会自动记下这个对话。
    expect(receipt).toContain('手机上')
    expect(receipt).toContain('自动')
  })

  it('disables the button while a send is in flight, so a double click cannot fire two messages', async () => {
    let release: (value: unknown) => void = () => undefined
    const pending = new Promise((resolve) => {
      release = resolve
    })
    const channels = installPlatform({
      list: vi.fn(async () => [{ ...channel, allowedChatIds: [] }]),
      sendTestMessage: vi.fn(() => pending)
    })
    const container = await mount()

    await act(async () => testButton(container).click())
    expect(testButton(container).disabled).toBe(true)

    await act(async () => {
      release({ state: 'accepted', messageId: 'm-2' })
      await Promise.resolve()
    })
    await act(async () => {})

    expect(testButton(container).disabled).toBe(false)
    expect(channels.sendTestMessage).toHaveBeenCalledTimes(1)
  })

  it('names the refusal for a rejected send and replaces the previous receipt instead of stacking lines', async () => {
    installPlatform({
      list: vi.fn(async () => [{ ...channel, allowedChatIds: [] }]),
      sendTestMessage: vi
        .fn()
        .mockResolvedValueOnce({ state: 'failed', reason: 'rejected' })
        .mockResolvedValueOnce({ state: 'failed', reason: 'ambiguous-target' })
    })
    const container = await mount()
    await act(async () => testButton(container).click())
    await act(async () => {})
    expect(container.querySelector('[data-test-receipt]')?.textContent).toBe(labels.channelTestRejected)

    await act(async () => testButton(container).click())
    await act(async () => {})

    const receipts = container.querySelectorAll('[data-test-receipt]')
    expect(receipts).toHaveLength(1)
    expect(receipts[0]?.textContent).toBe(labels.channelTestAmbiguousTarget)
  })
})


/**
 * 「怎么没有会话」这条（用户 2026-11-04 报）：手机来的会话属于频道绑定的那个助手，
 * 而侧栏只显示当前助手的会话。修法是**让读者显式点一下**跳过去——不是偷偷改当前助手。
 */
describe('opening the conversation a channel is bound to', () => {
  /** 「有没有绑定会话」是一次 IPC，挂载后再排一轮：多刷两次微任务再断言。 */
  async function mountSettled(): Promise<HTMLElement> {
    const container = await mount()
    await act(async () => {})
    await act(async () => {})
    return container
  }

  /** 入口是图标按钮：按读屏名找，不按文字找（行内不再有常驻文字）。 */
  function conversationButton(container: HTMLElement): HTMLButtonElement | undefined {
    return container.querySelector<HTMLButtonElement>(
      `button[aria-label="${labels.channelOpenConversation}"]`
    ) ?? undefined
  }

  function retryButton(container: HTMLElement): HTMLButtonElement | undefined {
    return container.querySelector<HTMLButtonElement>(
      `button[aria-label="${labels.channelConversationUnreadable}"]`
    ) ?? undefined
  }

  it('offers the entry only when the channel has a bound conversation', async () => {
    // 没绑过会话：给一个点了会跳到空列表的按钮，比不给更糟。
    installPlatform()
    const none = await mountSettled()
    expect(conversationButton(none)).toBeUndefined()

    installPlatform({
      listConversations: vi.fn(async () => [
        { id: 'c-1', kind: 'direct', hasBoundSession: false, targetEnabled: false, sessionTitle: null, createdAt: '2026-11-04' }
      ])
    })
    const unbound = await mountSettled()
    expect(conversationButton(unbound)).toBeUndefined()

    installPlatform({
      listConversations: vi.fn(async () => [
        { id: 'c-1', kind: 'direct', hasBoundSession: true, targetEnabled: true, sessionTitle: 'Telegram · 贾维斯', createdAt: '2026-11-04' }
      ])
    })
    const bound = await mountSettled()
    expect(conversationButton(bound)).toBeTruthy()
  })

  it('swaps the entry for a retry icon when the list cannot be read: shape, not colour, and no inline copy', async () => {
    // 「没有」和「拿不到」是两件事：读失败时入口换成**重试图标**（形状不同），行内不留常驻文字。
    installPlatform({
      listConversations: vi.fn(async () => { throw new Error('channel-input-invalid') })
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const container = await mountSettled()

    expect(conversationButton(container)).toBeUndefined()
    const retry = retryButton(container)
    expect(retry).toBeTruthy()
    // 可点：一个禁用的按钮配一句「再试一次」是读者做不到的指令。
    expect(retry?.disabled).toBe(false)
    // 行内没有常驻文字，那句只在悬停/读屏（即 aria-label）里。
    expect(container.querySelector('[data-conversation-unreadable]')).toBeNull()
    expect(container.textContent).not.toContain(labels.channelConversationUnreadable)
    // 失败要留痕：一句话、单参数（第二个对象参数会被主进程丢掉）。
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[channels] listConversations failed'))
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('channel-input-invalid'))
    errorSpy.mockRestore()

    // 确实没有会话时才是「什么都不画」。
    installPlatform({ listConversations: vi.fn(async () => []) })
    const none = await mountSettled()
    expect(conversationButton(none)).toBeUndefined()
    expect(retryButton(none)).toBeUndefined()
  })

  it('retries on click: opens when a session is found, falls back to "none" when there is none', async () => {
    // 第一条：读失败 → 点重试 → 读到会话 → 打开。
    const channels = installPlatform({
      listConversations: vi.fn()
        .mockRejectedValueOnce(new Error('channel-input-invalid'))
        .mockResolvedValueOnce([
          { id: 'c-1', kind: 'direct', hasBoundSession: true, targetEnabled: true, sessionTitle: 'Telegram · 贾维斯', createdAt: '2026-11-04' }
        ])
    })
    const navigations: unknown[] = []
    const onNavigate = (event: Event): void => { navigations.push((event as CustomEvent).detail) }
    window.addEventListener('app-shell:navigate', onNavigate)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const container = await mountSettled()
    expect(retryButton(container)).toBeTruthy()

    await act(async () => retryButton(container)?.click())
    await act(async () => {})
    expect(channels.listConversations).toHaveBeenCalledTimes(2)
    expect(channels.openConversation).toHaveBeenCalledWith({ channelId: 'channel-1', conversationId: 'c-1' })
    expect(navigations).toEqual([{ navKey: 'agents' }])
    expect(conversationButton(container)).toBeTruthy()
    errorSpy.mockRestore()
    window.removeEventListener('app-shell:navigate', onNavigate)

    // 第二条：读失败 → 点重试 → 读到了但确实没有会话 → 落回「不画」，**不许**打开空列表。
    installPlatform({
      listConversations: vi.fn()
        .mockRejectedValueOnce(new Error('channel-input-invalid'))
        .mockResolvedValueOnce([])
    })
    const body = await mountSettled()
    const navigationsAgain: unknown[] = []
    const onNavigateAgain = (event: Event): void => { navigationsAgain.push((event as CustomEvent).detail) }
    window.addEventListener('app-shell:navigate', onNavigateAgain)
    const errorSpyAgain = vi.spyOn(console, 'error').mockImplementation(() => {})
    await act(async () => retryButton(body)?.click())
    await act(async () => {})
    expect(retryButton(body)).toBeUndefined()
    expect(conversationButton(body)).toBeUndefined()
    expect(navigationsAgain).toEqual([])
    errorSpyAgain.mockRestore()
    window.removeEventListener('app-shell:navigate', onNavigateAgain)
  })

  it('selects the agent the channel is bound to and lands on the agents page', async () => {
    const channels = installPlatform({
      listConversations: vi.fn(async () => [
        { id: 'c-1', kind: 'direct', hasBoundSession: true, targetEnabled: true, sessionTitle: 'Telegram · 贾维斯', createdAt: '2026-11-04' }
      ])
    })
    const container = await mountSettled()
    const navigations: unknown[] = []
    const onNavigate = (event: Event): void => { navigations.push((event as CustomEvent).detail) }
    window.addEventListener('app-shell:navigate', onNavigate)

    await act(async () => conversationButton(container)?.click())
    await act(async () => {})

    // 渲染层只发频道 id + 对话 id：会话 id 不进渲染层（主进程查、主进程用）。
    expect(channels.openConversation).toHaveBeenCalledWith({ channelId: 'channel-1', conversationId: 'c-1' })
    expect(navigations).toEqual([{ navKey: 'agents' }])
    window.removeEventListener('app-shell:navigate', onNavigate)
  })

  it('does not pretend it jumped when the main process refuses to open the conversation', async () => {
    const channels = installPlatform({
      listConversations: vi.fn(async () => [
        { id: 'c-1', kind: 'direct', hasBoundSession: true, targetEnabled: true, sessionTitle: 'Telegram · 贾维斯', createdAt: '2026-11-04' }
      ]),
      openConversation: vi.fn(async () => ({ ok: false, code: 'conversation-session-missing' }))
    })
    const container = await mountSettled()
    const navigations: unknown[] = []
    const onNavigate = (event: Event): void => { navigations.push((event as CustomEvent).detail) }
    window.addEventListener('app-shell:navigate', onNavigate)

    await act(async () => conversationButton(container)?.click())
    await act(async () => {})

    expect(channels.openConversation).toHaveBeenCalled()
    // 打不开就**不许**跳：跳到旧助手的列表会让读者以为打开的是这一条。
    expect(navigations).toEqual([])
    // 具名原因直接给读者：读不到哪一条都收在一句通用失败里，等于什么都没说。
    expect(container.textContent).toContain(labels.channelFailureReason['conversation-session-missing'])
    window.removeEventListener('app-shell:navigate', onNavigate)
  })
})
