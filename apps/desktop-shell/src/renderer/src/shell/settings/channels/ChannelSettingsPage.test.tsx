// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { expectWaitingFirst } from '@platform/ui/async/expectWaitingFirst'

import { platformText } from '../../../i18n/platformText'
import { ChannelSettingsPage } from './ChannelSettingsPage'

const labels = platformText['zh-CN'].settings
let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const catalogEntries = [
  { type: 'telegram', status: 'planned', reason: 'release-a-pending', implemented: true, credentialFields: ['bot_token'] },
  { type: 'feishu', status: 'blocked', reason: 'adapter-blocked', implemented: false, credentialFields: [] }
]

function installPlatform(overrides: Record<string, unknown>): Record<string, ReturnType<typeof vi.fn>> {
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
})

describe('ChannelSettingsPage read failures and catalog copy', () => {
  it('surfaces a failed first read as an error with retry, never as an empty rail', async () => {
    installPlatform({ catalog: vi.fn(async () => { throw new Error('ipc-unavailable') }) })

    const container = await mount()

    // 读失败与「还没有通道」是两句话：前者给重试，后者给创建。画成空态就是告诉用户「你没有通道」。
    expect(stateOf(container, 'error')).not.toBeNull()
    expect(stateOf(container, 'empty')).toBeNull()
    expect(container.textContent).not.toContain(labels.channelStaleNotice)
  })

  it('names what each blocked adapter is missing', async () => {
    installPlatform({})

    const container = await mount()

    expect(container.textContent).toContain(labels.channelCatalogReason.planned)
    expect(container.textContent).toContain(labels.channelCatalogReason.blockedUnimplemented)
    expect(container.textContent).toContain('telegram')
  })
})

describe('three waiting states', () => {
  it('draws only loading before the first read returns — neither error nor empty', async () => {
    // 首次读永不返回：屏幕上只许有加载中。
    installPlatform({ catalog: vi.fn(() => new Promise(() => {})) })
    const container = await mount()

    // 加载态由 LoadingState 承担（它自己就是 live region，不再套一层 StateView）。
    expect(container.querySelector('.loading-state')).not.toBeNull()
    expect(stateOf(container, 'error')).toBeNull()
    expect(stateOf(container, 'empty')).toBeNull()
  })

  it('keeps the list and marks it as the last read when a refresh fails', async () => {
    const channels = installPlatform({
      list: vi.fn(async () => [{
        id: 'channel-1',
        type: 'telegram',
        name: 'Telegram',
        agentId: 'agent-1',
        state: 'credential-missing',
        credential: { status: 'missing', hasCredential: false }
      }])
    })
    const container = await mount()
    expect(container.textContent).toContain('Telegram')

    // 第二次读失败：列表是旧的，不该被换成一块空白或一个错误态。
    channels.list.mockRejectedValueOnce(new Error('ipc-unavailable'))
    const refresh = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === labels.channelRefresh
    )
    await act(async () => refresh?.click())

    expect(container.textContent).toContain('Telegram')
    expect(container.textContent).toContain(labels.channelStaleNotice)
    expect(stateOf(container, 'error')).toBeNull()
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

describe('status pills', () => {
  it('takes the tone from the status value, not from the position in the list', async () => {
    installPlatform({})
    const container = await mount()

    // 目录状态两枚：planned → muted、blocked → bad。档位查表得出，同一数据值只有一个答案。
    const planned = [...container.querySelectorAll('.status-pill')].find(
      (pill) => pill.textContent?.trim() === labels.channelCatalogStatus.planned
    )
    const blocked = [...container.querySelectorAll('.status-pill')].find(
      (pill) => pill.textContent?.trim() === labels.channelCatalogStatus.blocked
    )

    expect(planned?.className).toContain('status-pill--muted')
    expect(blocked?.className).toContain('status-pill--bad')
  })
})

describe('runtime status word', () => {
  it('answers whether the channel is running, not why it is not', async () => {
    installPlatform({
      list: vi.fn(async () => [{
        id: 'channel-1',
        type: 'telegram',
        name: 'Telegram',
        agentId: 'agent-1',
        state: 'credential-missing',
        credential: { status: 'missing', hasCredential: false }
      }])
    })
    const container = await mount()

    // 目录那枚已经回答了"为什么没发布"；这枚只回答"跑没跑"，并且是独立状态词的写法。
    const runtime = [...container.querySelectorAll('.status-pill')].find(
      (pill) => pill.textContent?.trim() === labels.channelNotRunning
    )
    expect(runtime?.className).toContain('status-pill--muted')
    expect(container.textContent).not.toContain(labels.channelPlanned)
  })
})

describe('detail pane read states', () => {
  const channel = {
    id: 'channel-1',
    type: 'telegram',
    name: 'Telegram',
    agentId: 'agent-1',
    state: 'credential-missing',
    credential: { status: 'missing', hasCredential: false }
  }

  it('draws the loading state, never a settled one, before the detail read resolves', async () => {
    // 台账口径（`MI-11-R164`）：首帧用例必须走 `expectWaitingFirst`，否则「各线自报」对不上。
    installPlatform({
      list: vi.fn(async () => [channel]),
      listPolicies: vi.fn(() => new Promise(() => {})),
      listConversations: vi.fn(() => new Promise(() => {})),
      listCandidates: vi.fn(() => new Promise(() => {})),
      runtimeStatus: vi.fn(() => new Promise(() => {}))
    })

    await expectWaitingFirst(createElement(ChannelSettingsPage, { language: 'zh-CN' }))
  })

  it('draws only loading for the detail pane before its first read returns', async () => {
    installPlatform({
      list: vi.fn(async () => [channel]),
      // 详情读永不返回：右栏只许有加载中，空态文案一个字都不许先出现。
      listPolicies: vi.fn(() => new Promise(() => {})),
      listConversations: vi.fn(() => new Promise(() => {})),
      listCandidates: vi.fn(() => new Promise(() => {})),
      runtimeStatus: vi.fn(() => new Promise(() => {}))
    })

    const container = await mount()

    // 加载态由 LoadingState 承担，不套 StateView（与左栏同一口径）。
    expect(container.querySelector('.loading-state')).not.toBeNull()
    expect(container.textContent).not.toContain(labels.channelCandidates)
    expect(container.textContent).not.toContain(labels.channelPolicy)
    expect(container.textContent).not.toContain(labels.channelCandidatesEmpty)
  })

  it('marks a failed detail read as unreadable with a retry that really re-reads', async () => {
    const channels = installPlatform({
      list: vi.fn(async () => [channel]),
      listPolicies: vi.fn(async () => { throw new Error('ipc-unavailable') }),
      listConversations: vi.fn(async () => { throw new Error('ipc-unavailable') }),
      listCandidates: vi.fn(async () => { throw new Error('ipc-unavailable') }),
      runtimeStatus: vi.fn(async () => { throw new Error('ipc-unavailable') })
    })

    const container = await mount()

    // 读失败不是「操作失败」：错误态给原因与重试，而不是写操作那句没有出路的提示。
    expect(stateOf(container, 'error')).not.toBeNull()
    expect(container.textContent).not.toContain(labels.channelOperationFailed)
    const callsBefore = channels.listPolicies.mock.calls.length

    channels.listPolicies.mockResolvedValue([{ id: 'policy-1', subjectType: 'user', conversationKind: null }])
    channels.listConversations.mockResolvedValue([])
    channels.listCandidates.mockResolvedValue([{
      id: 'candidate-1', kind: 'direct', displayLabel: 'Alice', firstSeenAt: '', lastSeenAt: '', hitCount: 1, status: 'pending'
    }])
    channels.runtimeStatus.mockResolvedValue(null)
    const retry = container.querySelector('.state-view__action') as HTMLButtonElement | null
    await act(async () => retry?.click())

    // 重试真的重读右栏详情（不是只重读左栏），读到后详情出现、错误态退场。
    expect(channels.listPolicies.mock.calls.length).toBeGreaterThan(callsBefore)
    expect(stateOf(container, 'error')).toBeNull()
    expect(container.textContent).toContain('Alice')
    expect(container.textContent).toContain(labels.channelCandidates)
  })

  it('keeps the detail on screen when a refresh fails, and says it is stale', async () => {
    const channels = installPlatform({
      list: vi.fn(async () => [channel]),
      listPolicies: vi.fn(async () => []),
      listConversations: vi.fn(async () => []),
      listCandidates: vi.fn(async () => [{
        id: 'candidate-1', kind: 'direct', displayLabel: 'Alice', firstSeenAt: '', lastSeenAt: '', hitCount: 1, status: 'pending'
      }]),
      runtimeStatus: vi.fn(async () => null),
      allowCandidate: vi.fn(async () => undefined)
    })

    const container = await mount()
    expect(container.textContent).toContain('Alice')

    // 之后一次详情刷新失败：详情留着，只加一行「这是上次读到的」+ 重试。
    channels.listPolicies.mockRejectedValueOnce(new Error('ipc-unavailable'))
    const allow = [...container.querySelectorAll('button')].find(
      // 两字中文按钮会被 antd 自动插空格（「允 许」），比较前先去掉空白。
      (button) => button.textContent?.replace(/\s+/g, '') === labels.channelCandidateAllow
    )
    await act(async () => allow?.click())

    expect(container.textContent).toContain(labels.channelDetailsStaleNotice)
    expect(container.textContent).toContain('Alice')
    expect(stateOf(container, 'error')).toBeNull()
  })
})
