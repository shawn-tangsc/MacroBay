import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { AgentSessionEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { AgentWorkspaceEntity } from '@platform/ai/agent-platform/schemas/workspaceSchemas'
import { createAgentStoreState } from '@platform/ai/agent-platform/store/agentStore'

// 确认框由 Provider 渲染；静态渲染用例不点删除，只要一个不抛错的实例。
vi.mock('@platform/ui/components/confirm', () => ({ useConfirm: () => vi.fn() }))

import AgentSidePanel from './AgentSidePanel'
import { AgentTextProvider } from './agentTextProvider'

const createdAt = '2026-01-01T00:00:00.000Z'
/** 「今天」是相对真实时钟的：夹具跟着走，否则这条会在第二天变红（那不是发现缺陷，是时钟）。 */
const todayAt = new Date().toISOString()

const workspace: AgentWorkspaceEntity = {
  id: 'workspace-1',
  name: 'Workspace',
  path: '/Users/demo/project',
  type: 'user',
  orderKey: 'workspace-1',
  createdAt,
  updatedAt: createdAt
}

const agents: AgentEntity[] = [
  agent('agent-1', 'Research Agent'),
  agent('agent-2', 'Code Agent')
]

const sessions: AgentSessionEntity[] = [
  session('session-1', 'agent-1', 'Research chat'),
  session('session-2', 'agent-2', 'Code chat')
]

describe('AgentSidePanel', () => {
  it('renders agent and session tabs while scoping sessions to the active agent', () => {
    const markup = renderToStaticMarkup(
      <AgentTextProvider language="zh-CN">
        <AgentSidePanel
          state={createAgentStoreState({
            agents,
            sessions,
            workspaces: [workspace],
            activeAgentId: 'agent-1',
            activeSessionId: 'session-1'
          })}
          runtimeStateBySessionId={{}}
          channelRuntimeSnapshot={{ channels: [] }}
          sessionPanelPosition="left"
          onUpdateSessionPanelPosition={() => undefined}
          onCreateAgent={() => undefined}
          onEditAgent={() => undefined}
          onStateChange={(updater) => updater({} as never)}
        />
      </AgentTextProvider>
    )

    expect(markup).toContain('role="tablist"')
    expect(markup).toContain('>智能体<')
    expect(markup).toContain('>会话<')
    expect(markup).toContain('>新建会话<')
    expect(markup).toContain('Research chat')
    expect(markup).not.toContain('Code chat')
  })

  it('keeps the action bar inside its panel, above the scrollable content', () => {
    const markup = renderToStaticMarkup(
      <AgentTextProvider language="zh-CN">
        <AgentSidePanel
          state={createAgentStoreState({
            agents,
            sessions,
            workspaces: [workspace],
            activeAgentId: 'agent-1',
            activeSessionId: 'session-1'
          })}
          runtimeStateBySessionId={{}}
          channelRuntimeSnapshot={{ channels: [] }}
          sessionPanelPosition="left"
          onUpdateSessionPanelPosition={() => undefined}
          onCreateAgent={() => undefined}
          onEditAgent={() => undefined}
          onStateChange={(updater) => updater({} as never)}
        />
      </AgentTextProvider>
    )

    const panelStart = markup.indexOf('role="tabpanel"')
    // 动作条不属于 tablist：它是面板自己的第一行。
    expect(markup.slice(0, panelStart)).not.toContain('agent-side-panel-action')
    const panel = markup.slice(panelStart)
    // 面板结构 = [动作条][可滚动内容]，动作条在前；`Tabs` 挂载的另一块在 hidden 里，不受影响。
    expect(panel).toContain('<div class="agent-side-panel-panel"><div class="agent-side-panel-action">')
    expect(panel.indexOf('agent-side-panel-action')).toBeLessThan(panel.indexOf('agent-side-panel-content'))
  })

  it('keeps automated sessions out of the reader list and shows them as their own block', () => {
    const markup = renderToStaticMarkup(
      <AgentTextProvider language="zh-CN">
        <AgentSidePanel
          state={createAgentStoreState({
            agents,
            sessions: [
              session('session-1', 'agent-1', 'Research chat'),
              automatedSession('auto-1', 'agent-1', todayAt, '持仓骤降 · 15 分钟')
            ],
            workspaces: [workspace],
            activeAgentId: 'agent-1',
            activeSessionId: 'session-1'
          })}
          runtimeStateBySessionId={{}}
          channelRuntimeSnapshot={{ channels: [] }}
          sessionPanelPosition="left"
          onUpdateSessionPanelPosition={() => undefined}
          onCreateAgent={() => undefined}
          onEditAgent={() => undefined}
          onStateChange={(updater) => updater({} as never)}
        />
      </AgentTextProvider>
    )

    // 默认列表：读者的那条在，自动那条不在。
    expect(markup).toContain('Research chat')
    expect(markup).not.toContain('持仓骤降')
    // 自动块：独立一块 + 一行摘要（今天 1 条 · 共 1 条）。
    expect(markup).toContain('agent-auto-sessions')
    expect(markup).toContain('自动会话')
    expect(markup).toContain('今天 1 条 · 共 1 条')
    // **块必须长在滚动容器里**（`.agent-session-list`）。它曾是列表的兄弟：块没 overflow、
    // 又压不动（flex 子项 `min-height:auto`），条数一多就把列表挤到 0 高、自己被祖先
    // `overflow:hidden` 裁掉——滚轮落在被裁区域上没有任何容器可动（用户 2026-11-09 报的「滚动卡住」）。
    // 用固定缩进判「直接子节点」不够：这里直接断言块在容器内部，且容器是唯一滚动条那条。
    expect(markup).toMatch(/class="agent-session-list"[\s\S]*agent-auto-sessions[\s\S]*<\/div>/)
  })

  it('draws no automation block when there is nothing in it', () => {
    const markup = renderToStaticMarkup(
      <AgentTextProvider language="zh-CN">
        <AgentSidePanel
          state={createAgentStoreState({
            agents,
            sessions: [session('session-1', 'agent-1', 'Research chat')],
            workspaces: [workspace],
            activeAgentId: 'agent-1',
            activeSessionId: 'session-1'
          })}
          runtimeStateBySessionId={{}}
          channelRuntimeSnapshot={{ channels: [] }}
          sessionPanelPosition="left"
          onUpdateSessionPanelPosition={() => undefined}
          onCreateAgent={() => undefined}
          onEditAgent={() => undefined}
          onStateChange={(updater) => updater({} as never)}
        />
      </AgentTextProvider>
    )

    expect(markup).not.toContain('agent-auto-sessions')
  })

  it('says the reader has not started one, not that there are no sessions, when only automation exists', () => {
    const markup = renderToStaticMarkup(
      <AgentTextProvider language="zh-CN">
        <AgentSidePanel
          state={createAgentStoreState({
            agents,
            sessions: [automatedSession('auto-1', 'agent-1', todayAt, '持仓骤降 · 15 分钟')],
            workspaces: [workspace],
            activeAgentId: 'agent-1',
            activeSessionId: null
          })}
          runtimeStateBySessionId={{}}
          channelRuntimeSnapshot={{ channels: [] }}
          sessionPanelPosition="left"
          onUpdateSessionPanelPosition={() => undefined}
          onCreateAgent={() => undefined}
          onEditAgent={() => undefined}
          onStateChange={(updater) => updater({} as never)}
        />
      </AgentTextProvider>
    )

    expect(markup).toContain('你还没有发起过会话。')
    expect(markup).not.toContain('还没有会话，先创建一个。')
  })

  it('does not render nested buttons in session rows', () => {
    const markup = renderToStaticMarkup(
      <AgentTextProvider language="zh-CN">
        <AgentSidePanel
          state={createAgentStoreState({
            agents,
            sessions,
            workspaces: [workspace],
            activeAgentId: 'agent-1',
            activeSessionId: 'session-1'
          })}
          runtimeStateBySessionId={{}}
          channelRuntimeSnapshot={{ channels: [] }}
          sessionPanelPosition="left"
          onUpdateSessionPanelPosition={() => undefined}
          onCreateAgent={() => undefined}
          onEditAgent={() => undefined}
          onStateChange={(updater) => updater({} as never)}
        />
      </AgentTextProvider>
    )

    expect(markup).not.toMatch(/<button[^>]*class="[^"]*agent-session-item[\s\S]*?<button/)
  })
})

function agent(id: string, name: string): AgentEntity {
  return {
    id,
    type: 'claude-code',
    name,
    model: `provider:${id}`,
    modelName: id,
    createdAt,
    updatedAt: createdAt,
    orderKey: id,
    configuration: {}
  }
}

function automatedSession(id: string, agentId: string, createdAtIso: string, name: string): AgentSessionEntity {
  return {
    id,
    agentId,
    name,
    workspaceId: workspace.id,
    workspace,
    orderKey: id,
    origin: 'automation',
    originGroup: 'market-analysis',
    createdAt: createdAtIso,
    updatedAt: createdAtIso
  }
}

function session(id: string, agentId: string, name: string): AgentSessionEntity {
  return {
    id,
    agentId,
    name,
    workspaceId: workspace.id,
    workspace,
    orderKey: id,
    createdAt,
    updatedAt: createdAt
  }
}
