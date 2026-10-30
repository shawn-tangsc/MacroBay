// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { productText } from '../../shared/i18n/productText'
import { MarketAnalysisAgentWorkspace } from './MarketAnalysisAgentWorkspace'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  // The composer keeps its draft in localStorage; a leftover draft would leak between cases.
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

const text = productText['zh-CN'].pages.intelligence.portal
// The conversation now lives behind the floating control, so every case opens it first.
const floatingText = { open: text.calendarCard.expandAgent, close: text.calendarCard.closeAgent, title: text.calendarCard.agentTitle }
const NOW = '2026-10-23T07:24:44.215Z'
const WORKSPACE = { id: 'ws-system', name: '系统工作区', path: '/tmp/mi-workspace', type: 'system', orderKey: '0', createdAt: NOW, updatedAt: NOW }
const EMPTY_RUNTIME = { sessions: {}, toolApprovals: [], toolApprovalHistory: [], chunksBySessionId: {}, updatedAt: NOW }
const EMPTY_TIMELINE = { schemaVersion: 1, items: [], nextCursor: null }

type FixtureState = {
  activeAgentId?: string
  agents: Record<string, unknown>[]
  sessions: Record<string, unknown>[]
  messagesBySessionId: Record<string, Record<string, unknown>[]>
}

function agentFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'crypto-market-analyst',
    type: 'claude-code',
    name: '数字货币市场解读员',
    description: '基于可追溯市场证据生成条件式分析。',
    instructions: '只基于可追溯证据。',
    model: 'test:model',
    modelName: 'Test / Model',
    mcps: [],
    disabledTools: [],
    configuration: { permission_mode: 'plan' },
    createdAt: NOW,
    updatedAt: NOW,
    orderKey: '0100',
    ...overrides
  }
}

function sessionFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 's-1',
    agentId: 'crypto-market-analyst',
    name: '市场解读对话',
    description: 'market-analysis-conversation',
    workspaceId: WORKSPACE.id,
    workspace: WORKSPACE,
    orderKey: '1',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  }
}

function messageFixture(
  id: string,
  role: 'user' | 'assistant',
  body: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    sessionId: 's-1',
    role,
    status: 'success',
    searchableText: body,
    data: { parts: [{ type: 'text', text: body }] },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  }
}

/**
 * The floating panel hosts the agent page's own conversation surface, so the stub carries the four
 * sources that surface reads (store, runtime, settings, provider catalog) and pushes store updates
 * the way the main process does.
 */
function stubPlatform(options: {
  state?: Partial<FixtureState>
  invoke?: (product: string, method: string, payload?: unknown) => Promise<unknown>
  agents?: Record<string, unknown>
} = {}) {
  const state: FixtureState = {
    activeAgentId: 'crypto-market-analyst',
    agents: [agentFixture()],
    sessions: [],
    messagesBySessionId: {},
    ...options.state
  }
  const listeners = new Set<(next: FixtureState) => void>()
  const push = () => {
    for (const listener of listeners) listener(state)
  }
  const createSession = vi.fn(async (input: Record<string, unknown>) => {
    const created = sessionFixture({ ...input, id: `s-${state.sessions.length + 1}` })
    state.sessions.push(created)
    push()
    return created
  })
  const sendMessage = vi.fn(async (input: { sessionId: string; text: string }) => {
    const answered = messageFixture(`answer-${input.text}`, 'assistant', `回复 ${input.text}`, { sessionId: input.sessionId })
    state.messagesBySessionId[input.sessionId] = [...(state.messagesBySessionId[input.sessionId] ?? []), answered]
    push()
    return { state }
  })
  const platform = {
    products: {
      invoke: options.invoke ?? (async (_product: string, method: string) =>
        method === 'marketAnalysis.listTimeline' ? EMPTY_TIMELINE : EMPTY_TIMELINE)
    },
    settings: {
      get: async () => ({
        language: 'zh-CN',
        chat: {
          messageStyle: 'plain',
          fontSize: 14,
          sendShortcut: 'enter',
          confirmDeleteMessage: true,
          messageNavigation: 'none',
          narrowMode: false
        },
        modelDefaults: { agentModelId: 'test:model' }
      }),
      update: async (patch: unknown) => patch
    },
    modelProviders: { list: async () => [] },
    app: {
      onQuotedToMain: () => () => undefined,
      selectFiles: async () => []
    },
    agents: {
      getState: async () => state,
      getRuntimeSnapshot: async () => EMPTY_RUNTIME,
      onStateChanged: (listener: (next: FixtureState) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      onRuntimeStateChanged: () => () => undefined,
      createSession,
      sendMessage,
      cancelSession: vi.fn(async () => true),
      deleteSessions: vi.fn(async () => undefined),
      ...options.agents
    }
  }
  vi.stubGlobal('platform', platform)
  return { platform, state, createSession, sendMessage }
}

it('puts a rail header above the split, not inside the calendar row', async () => {
  const panel = await renderPanel({ railHeader: createElement('p', { 'data-rail-header': true }, '利率路径') }, false)
  const aside = panel.querySelector('aside')!
  const header = aside.querySelector('[data-rail-header]')
  const panes = aside.querySelector('.mi-analysis-agent-workspace__panes')
  expect(header).not.toBeNull()
  expect(panes).not.toBeNull()
  // The header is a sibling of the split so the calendar and the news share what is left below it;
  // inside the row it would eat the calendar's height instead.
  expect(header!.nextElementSibling).toBe(panes)
  expect(panes!.querySelector('[data-card]')).not.toBeNull()
})

async function renderPanel(props: Record<string, unknown> = {}, openPanel = true): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      createElement(MarketAnalysisAgentWorkspace, {
        text,
        floatingText,
        card: createElement('p', { 'data-card': true }, '接下来要看的'),
        ...props
      } as never)
    )
  })
  if (openPanel) {
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-agent-floating-button]')?.click()
    })
    // Let the conversation surface read the store and mount the composer.
    await act(async () => { await Promise.resolve() })
  }
  return container
}

async function ask(container: HTMLElement, question: string): Promise<void> {
  await act(async () => {
    const input = container.querySelector('textarea')!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, question)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

describe('market analysis embedded workspace', () => {
  it('renders assistant Markdown as headings, emphasis, lists and code without interpreting raw HTML', async () => {
    const markdown = ['## 分析说明', '', '**我会做的：**', '- 区分**事实**和假设', '- 引用来源', '', '1. 检查 `BTC`', '2. 核对风险', '', '| 项目 | 时间 |', '| --- | --- |', '| UTC | 06:00 |', '| 北京时间 | 14:00 |', '', '```ts', 'const asset = "BTC"', '```', '', '<script>alert(1)</script>'].join('\n')
    stubPlatform({ state: { sessions: [sessionFixture()], messagesBySessionId: { 's-1': [messageFixture('m-1', 'assistant', markdown)] } } })
    const container = await renderPanel()

    expect(container.querySelector('.agent-markdown h2')?.textContent).toBe('分析说明')
    expect([...container.querySelectorAll('.agent-markdown strong')].map((node) => node.textContent)).toContain('我会做的：')
    expect(container.querySelectorAll('.agent-markdown ul li')).toHaveLength(2)
    expect(container.querySelectorAll('.agent-markdown ol li')).toHaveLength(2)
    expect(container.querySelector('.agent-markdown li code')?.textContent).toBe('BTC')
    expect(container.querySelector('.agent-markdown pre code')?.textContent).toBe('const asset = "BTC"')
    // A table renders as a table, never as raw pipes.
    expect([...container.querySelectorAll('table th')].map((node) => node.textContent)).toEqual(['项目', '时间'])
    expect(container.querySelector('.agent-markdown script')).toBeNull()
  })

  it('shows the product prompt, not the agent page hero, in an empty conversation', async () => {
    stubPlatform()
    const container = await renderPanel()

    expect(container.textContent).toContain(text.analysisWorkspace.empty)
    expect(container.textContent).not.toContain('开始一次智能体会话')
  })

  it('orders a late-arriving assistant reply after its same-turn user question', async () => {
    const createdAt = '2026-09-29T17:10:35.663Z'
    stubPlatform({
      state: {
        sessions: [sessionFixture()],
        messagesBySessionId: {
          's-1': [
            messageFixture('assistant-1', 'assistant', '回答', { createdAt, updatedAt: '2026-09-29T17:16:03.039Z' }),
            messageFixture('user-1', 'user', '问题', { createdAt, updatedAt: createdAt })
          ]
        }
      }
    })
    const container = await renderPanel()
    expect([...container.querySelectorAll('.agent-chat-bubble')].map((node) => node.getAttribute('data-role'))).toEqual(['user', 'assistant'])
  })

  it('opens one conversation for the panel and reopens that same one instead of starting another', async () => {
    const { createSession } = stubPlatform()
    const container = await renderPanel()

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'crypto-market-analyst', name: expect.any(String), description: 'market-analysis-conversation', workspace: { type: 'system' }
    }))
    expect(container.querySelector('textarea')).not.toBeNull()

    await act(async () => { container.querySelector<HTMLButtonElement>('.mi-agent-floating__close')!.click() })
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-agent-floating-button]')?.click() })
    await act(async () => { await Promise.resolve() })
    expect(createSession).toHaveBeenCalledTimes(1)
  })

  it('blocks the conversation while the injected selection is still loading', async () => {
    stubPlatform({ invoke: async () => [] })
    const container = await renderPanel({
      selectionState: 'loading',
      binding: { eventGroupId: 'eg-1', analysisRunId: 'ar-1', summaryId: 'as-1', asOf: NOW }
    })

    // The composer stays visible but refuses input while the selection is unresolved.
    expect(container.textContent).toContain(text.analysisTimeline.loading)
  })

  it('blocks the conversation after the injected selection failed', async () => {
    stubPlatform({ invoke: async () => [] })
    const container = await renderPanel({ selectionState: 'unavailable' })

    expect(container.textContent).toContain(text.analysisTimeline.unavailable)
  })

  it('sends through the real platform bridge with the locked analysis identity', async () => {
    const { sendMessage } = stubPlatform({
      state: { sessions: [sessionFixture()] }
    })
    const container = await renderPanel({
      binding: { eventGroupId: 'eg-1', analysisRunId: 'ar-1', summaryId: 'as-1', asOf: '2026-10-22T00:37:48.185Z' }
    })
    await ask(container, '这条结论怎么读')

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'crypto-market-analyst',
      sessionId: 's-1',
      text: expect.stringContaining('[eventGroupId=eg-1; analysisRunId=ar-1; summaryId=as-1'),
      displayText: '这条结论怎么读',
      context: expect.objectContaining({ kind: 'market-analysis-node', label: '引用分析' })
    }))
  })

  it('keeps technical binding identifiers out of the chat status after selecting an analysis', async () => {
    stubPlatform({
      invoke: async (_product, method) => {
        if (method === 'marketAnalysis.listTimeline') {
          return {
            schemaVersion: 1,
            items: [{ id: 'tl-1', eventGroupId: 'eg-1', analysisRunId: 'ar-1', kind: 'analysis', status: 'published', occurredAt: '2026-09-28T00:00:00.000Z', summaryRef: 'as-1', safeTitle: '已选分析', safeExcerpt: '结论', version: 1 }],
            nextCursor: null
          }
        }
        if (method === 'marketAnalysis.getAnalysisRun') {
          return { id: 'ar-1', eventGroupId: 'eg-1', analysisPhase: 'initial', status: 'succeeded', failureCode: null, queuedAt: NOW, startedAt: NOW, completedAt: NOW, asOf: NOW, dataCutoff: NOW, evidenceCount: 1, change: null }
        }
        if (method === 'marketAnalysis.getSummary') {
          return { id: 'as-1', schemaVersion: 1, analysisRunId: 'ar-1', eventGroupId: 'eg-1', version: 1, eventAssessment: '结论', knownFacts: [], transmissionHypotheses: [], marketReaction: [], supportingEvidence: [], counterEvidence: [], scenarios: [], nextCatalysts: [], dataCaveats: [], evidenceRefs: ['ev-1'], createdAt: NOW }
        }
        return []
      }
    })
    const container = await renderPanel({
      binding: { eventGroupId: 'eg-1', analysisRunId: 'ar-1', summaryId: 'as-1', asOf: NOW }
    })
    expect(container.textContent).toContain(text.analysisWorkspace.selectedAnalysis)
    expect(container.querySelector('.mi-analysis-chat__binding')?.textContent).not.toContain('eg-1')
    expect(container.querySelector('.mi-analysis-chat__binding')?.textContent).not.toContain('ar-1')
  })

  it('starts a new conversation by creating a session the platform accepts, not a partial DTO', async () => {
    const { createSession } = stubPlatform({
      state: { sessions: [sessionFixture()], messagesBySessionId: { 's-1': [messageFixture('m-1', 'assistant', '旧内容')] } }
    })
    const container = await renderPanel()
    expect(container.textContent).toContain('旧内容')

    await act(async () => { container.querySelector<HTMLButtonElement>('[data-agent-new-conversation]')!.click() })
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'crypto-market-analyst', name: expect.any(String), description: 'market-analysis-conversation', workspace: { type: 'system' }
    }))
  })

  it('sends the selected calendar event with the question as an identity reference', async () => {
    const { sendMessage } = stubPlatform()
    const container = await renderPanel({
      selectedContextLabel: '10-13 12:30 经济指标 消费者物价指数（CPI）',
      onClearSelectedContext: () => undefined
    })
    await ask(container, '这条数据意味着什么')

    expect(container.querySelector('.mi-analysis-chat__binding')?.textContent).toContain('选中事件')
    expect(container.querySelector('.mi-analysis-chat__binding')?.textContent).not.toContain('已绑定选中分析')
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('[选中事件: 10-13 12:30 经济指标 消费者物价指数（CPI）]'),
      displayText: '这条数据意味着什么',
      context: expect.objectContaining({ kind: 'market-calendar-event', label: '10-13 12:30 经济指标 消费者物价指数（CPI）' })
    }))
  })

  it('lets the calendar event win when a stale analysis binding is still present', async () => {
    const { sendMessage } = stubPlatform()
    const container = await renderPanel({
      binding: { eventGroupId: 'eg-1', analysisRunId: 'ar-1', summaryId: 'as-1', asOf: '2026-10-22T00:37:48.185Z' },
      selectedContextLabel: '10-13 12:30 经济指标 消费者物价指数（CPI）',
      onClearSelectedContext: () => undefined
    })
    await ask(container, '这条数据意味着什么')

    const sent = (sendMessage.mock.calls[0] as unknown as [{ text: string }])[0].text
    expect(sent).toContain('[选中事件:')
    expect(sent).not.toContain('[eventGroupId=eg-1')
  })

  it('reads the selected events facts once and sends them before the identity reference', async () => {
    const invoke = vi.fn(async (_product: string, method: string) => (method === 'marketAnalysis.calendarEventContext'
      ? { facts: [{ factId: 'k-1', metric: '实际值', value: '0.3%' }], evidenceRefs: [], coverage: 'available', caveats: [] }
      : EMPTY_TIMELINE))
    const { sendMessage } = stubPlatform({ invoke })
    const container = await renderPanel({
      selectedContextLabel: '10-13 12:30 经济指标 消费者物价指数（CPI）',
      selectedEventKey: 'US.CPI',
      selectedEventMonth: '2026-10',
      onClearSelectedContext: () => undefined
    })
    await ask(container, '这条数据意味着什么')

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('market-intelligence', 'marketAnalysis.calendarEventContext', expect.objectContaining({ eventKey: 'US.CPI', month: '2026-10' }))
    const sent = (sendMessage.mock.calls[0] as unknown as [{ text: string }])[0].text
    expect(sent).toContain('实际值 0.3%')
    expect(sent.indexOf('实际值 0.3%')).toBeLessThan(sent.indexOf('[选中事件:'))
  })

  it('still asks the question when the facts cannot be read', async () => {
    const invoke = vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.calendarEventContext') throw new Error('unavailable')
      return EMPTY_TIMELINE
    })
    const { sendMessage } = stubPlatform({ invoke })
    const container = await renderPanel({
      selectedContextLabel: '10-13 12:30 经济指标 消费者物价指数（CPI）',
      selectedEventKey: 'US.CPI',
      selectedEventMonth: '2026-10',
      onClearSelectedContext: () => undefined
    })
    await ask(container, '这条数据意味着什么')

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect((sendMessage.mock.calls[0] as unknown as [{ text: string }])[0].text).toContain('[选中事件:')
  })
})
