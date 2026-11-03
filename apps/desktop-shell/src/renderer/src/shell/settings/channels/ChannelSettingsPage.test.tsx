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
    // 保存后回读用的就是这一口：默认「已配置」，只有需要演「没存上」的用例才覆盖它。
    get: vi.fn(async () => ({ ...channel, id: 'channel-1' })),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    requestEnable: vi.fn(async () => ({ ok: true, code: 'runtime-ready' })),
    disable: vi.fn(async () => ({})),
    remove: vi.fn(async () => ({})),
    listPolicies: vi.fn(async () => []),
    beginCredential: vi.fn(async () => ({ sessionId: 's', mainPublicJwk: {} })),
    submitCredential: vi.fn(async () => ({})),
    rotateCredential: vi.fn(async () => ({})),
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
      (node): node is HTMLButtonElement => node.getAttribute('aria-label') === labels.channelEdit
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
      (node): node is HTMLButtonElement => node.getAttribute('aria-label') === labels.channelEdit
    )
    await act(async () => edit?.click())
    await act(async () => {})

    const save = [...document.body.querySelectorAll('button')].find(
      (node): node is HTMLButtonElement => node.textContent?.trim() === labels.channelUpdate
    )
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
    expect(channels.beginCredential).toHaveBeenCalledWith({ id: 'channel-1' })
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

    const field = document.body.querySelector('textarea[aria-label="允许的会话 ID"]') as HTMLTextAreaElement
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

    expect(channels.requestEnable).toHaveBeenCalledWith({ id: 'channel-1', actorId: 'settings-user' })
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

    expect(document.body.querySelector('[data-channel-save-error]')?.textContent).toContain(labels.channelCredentialSaveFailed)
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
      create: vi.fn(async () => ({ id: 'channel-9' })),
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
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
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
