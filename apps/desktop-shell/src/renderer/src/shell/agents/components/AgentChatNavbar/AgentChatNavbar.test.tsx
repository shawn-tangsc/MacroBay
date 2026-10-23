import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import type { AgentSessionEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { AgentWorkspaceEntity } from '@platform/ai/agent-platform/schemas/workspaceSchemas'
import { createAgentStoreState } from '@platform/ai/agent-platform/store/agentStore'

import { platformText } from '../../../../i18n/platformText'
import { AgentTextProvider } from '../../agentTextProvider'
import AgentChatNavbar from './index'

const timestamp = '2026-01-01T00:00:00.000Z'

describe('AgentChatNavbar', () => {
  it('keeps the agent config action beside the active agent name instead of in the right toolbar', () => {
    const markup = renderToStaticMarkup(
      <AgentTextProvider language="zh-CN">
        <AgentChatNavbar
          state={createAgentStoreState({
            agents: [agent()],
            sessions: [session()],
            workspaces: [workspace()]
          })}
          providers={[]}
          activeAgent={agent()}
          activeSession={session()}
          onStateChange={(updater) => updater({} as never)}
          onChatSettingsChange={() => undefined}
          onEditAgent={() => undefined}
        />
      </AgentTextProvider>
    )

    const identityMarkup = sliceBetweenClasses(markup, 'agent-chat-identity', 'agent-chat-toolbar')
    const toolbarMarkup = sliceBetweenClasses(markup, 'agent-chat-toolbar', 'agent-chat-settings-drawer')

    expect(identityMarkup).toContain('智能体配置')
    expect(toolbarMarkup).not.toContain('智能体配置')
  })

  it('shows the configured default model when the agent has no explicit model', () => {
    const unconfigured = { ...agent(), model: 'unconfigured:default-chat-model', modelName: 'No model selected' }
    const provider: SafeModelProvider = {
      id: 'anthropic',
      name: 'Anthropic',
      endpoints: [{ protocol: 'messages', baseUrl: 'https://api.anthropic.com' }],
      enabled: true,
      baseUrl: 'https://api.anthropic.com',
      hasApiKey: true,
      apiKeyPreview: 'sk-t**********1234',
      models: [
        {
          id: 'claude-sonnet',
          name: 'Claude Sonnet',
          messagesSupport: 'yes',
          capabilities: { chat: true, agentRuntimes: { claudeCode: true } }
        }
      ]
    }

    const markup = renderToStaticMarkup(
      <AgentTextProvider language="en-US">
        <AgentChatNavbar
          state={createAgentStoreState({
            agents: [unconfigured],
            sessions: [session()],
            workspaces: [workspace()]
          })}
          providers={[provider]}
          activeAgent={unconfigured}
          activeSession={session()}
          defaultAgentModelId="anthropic:claude-sonnet"
          onStateChange={(updater) => updater({} as never)}
          onChatSettingsChange={() => undefined}
          onEditAgent={() => undefined}
        />
      </AgentTextProvider>
    )

    expect(markup).toContain('Following default: Anthropic / Claude Sonnet')
    expect(markup).not.toContain('unconfigured:default-chat-model')
  })

  it('does not clip the agent identity after the edit action joins the title area', () => {
    const css = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/styles.css'), 'utf8')
    const identityRule = sliceCssRule(css, '.agent-chat-identity')
    const copyRule = sliceCssRule(css, '.agent-chat-identity-copy')

    expect(identityRule).not.toMatch(/(^|\n)\s*height:\s*32px;/)
    expect(identityRule).toContain('min-height:')
    expect(copyRule).toContain('line-height:')
  })

  it('uses a stable title grid so the edit action does not stagger the agent name', () => {
    const css = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/styles.css'), 'utf8')
    const identityRule = sliceCssRule(css, '.agent-chat-identity')
    const buttonRule = sliceCssRule(css, '.agent-chat-agent-config-button.ant-btn')

    expect(identityRule).toContain('grid-template-columns: 26px minmax(0, 1fr) 22px;')
    expect(identityRule).toContain('align-items: center;')
    expect(buttonRule).toContain('align-self: start;')
    expect(buttonRule).toContain('margin-top:')
  })

  it('renders only the agent name in the identity row, never the generated session title', () => {
    const activeAgent = agent()
    for (const sessionName of [activeAgent.name, '请使用 AskUserQuestion 工具问我一个问题']) {
      const activeSession = session({ name: sessionName })

      const markup = renderToStaticMarkup(
        <AgentTextProvider language="zh-CN">
          <AgentChatNavbar
            state={createAgentStoreState({
              agents: [activeAgent],
              sessions: [activeSession],
              workspaces: [workspace()]
            })}
            providers={[]}
            activeAgent={activeAgent}
            activeSession={activeSession}
            onStateChange={(updater) => updater({} as never)}
            onChatSettingsChange={() => undefined}
            onEditAgent={() => undefined}
          />
        </AgentTextProvider>
      )

      const identityMarkup = sliceBetweenClasses(markup, 'agent-chat-identity', 'agent-chat-toolbar')

      expect(identityMarkup).toContain('<strong>test助手</strong>')
      expect(identityMarkup).not.toContain('<small>')
      expect(identityMarkup).toContain('aria-label="test助手"')
      if (sessionName !== activeAgent.name) expect(identityMarkup).not.toContain(sessionName)
    }
  })

  it('renders the system workspace label from i18n instead of the persisted seed name', () => {
    const seeded = workspace({ name: '默认工作区' })
    const render = (language: 'zh-CN' | 'en-US') =>
      renderToStaticMarkup(
        <AgentTextProvider language={language}>
          <AgentChatNavbar
            state={createAgentStoreState({ agents: [agent()], sessions: [session({ workspace: seeded })], workspaces: [seeded] })}
            providers={[]}
            activeAgent={agent()}
            activeSession={session({ workspace: seeded })}
            onStateChange={(updater) => updater({} as never)}
            onChatSettingsChange={() => undefined}
            onEditAgent={() => undefined}
          />
        </AgentTextProvider>
      )

    expect(render('en-US')).toContain('System Workspace')
    expect(render('zh-CN')).toContain('系统工作区')
    expect(render('zh-CN')).not.toContain('默认工作区')
  })
})

/**
 * PLAT-70：触发器里必须是「模型名 + 小字厂商名」，只看名字分不清同名模型。
 * （下拉的分组/搜索/置灰由 `agentModelSelectOptions.test.tsx` 覆盖，antd 下拉在 SSR 里不渲染。）
 */
describe('AgentChatNavbar model selector trigger', () => {
  const provider: SafeModelProvider = {
    id: 'silicon',
    name: 'Silicon',
    endpoints: [
      { protocol: 'messages', baseUrl: 'https://api.siliconflow.cn' }
    ],
    enabled: true,
    baseUrl: 'https://api.siliconflow.cn',

    hasApiKey: true,
    apiKeyPreview: 'sk...test',
    isSystem: true,
    models: [
      {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        capabilities: { chat: true, vision: false, embedding: false, tools: false, agentRuntimes: { claudeCode: true } }
      }
    ],
    defaultChatModelId: 'deepseek-v4-pro'
  }

  it('shows the model name and the provider name for the selected model', () => {
    const activeAgent = { ...agent(), model: 'silicon:deepseek-v4-pro', modelName: 'DeepSeek V4 Pro' }
    const markup = renderToStaticMarkup(
      <AgentTextProvider language="zh-CN">
        <AgentChatNavbar
          state={createAgentStoreState({
            agents: [activeAgent],
            sessions: [session()],
            workspaces: [workspace()]
          })}
          providers={[provider]}
          activeAgent={activeAgent}
          activeSession={session()}
          onStateChange={(updater) => updater({} as never)}
          onChatSettingsChange={() => undefined}
          onEditAgent={() => undefined}
        />
      </AgentTextProvider>
    )

    expect(markup).toContain('DeepSeek V4 Pro')
    // 厂商名走 `resolveProviderDisplayName`（与下拉组标题同一份 i18n）。
    expect(markup).toContain(`data-model-picker-provider="true">${platformText['zh-CN'].models.providerNames.silicon}</span>`)
  })
})

function agent(): AgentEntity {
  return {
    id: 'agent-1',
    type: 'claude-code',
    name: 'test助手',
    description: 'A test agent',
    instructions: 'Help',
    model: null,
    modelName: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    orderKey: 'agent-1',
    configuration: {}
  }
}

function session(overrides: Partial<AgentSessionEntity> = {}): AgentSessionEntity {
  return {
    id: 'session-1',
    agentId: 'agent-1',
    name: 'test会话',
    workspaceId: 'workspace-1',
    workspace: workspace(),
    orderKey: 'session-1',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  }
}

function workspace(overrides: Partial<AgentWorkspaceEntity> = {}): AgentWorkspaceEntity {
  return {
    id: 'workspace-1',
    name: 'Default Workspace',
    path: '',
    type: 'system',
    orderKey: 'workspace-1',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  }
}

function sliceBetweenClasses(markup: string, startClass: string, endClass: string): string {
  const start = markup.indexOf(startClass)
  if (start === -1) return ''
  const end = markup.indexOf(endClass, start + startClass.length)
  return end === -1 ? markup.slice(start) : markup.slice(start, end)
}

function sliceCssRule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) return ''
  const end = css.indexOf('\n}', start)
  return end === -1 ? css.slice(start) : css.slice(start, end)
}
