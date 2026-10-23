import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { AgentSessionMessageEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'

import { agentText } from '../agentText'
import type { AgentMessageGroup } from '@platform/ui/agent-chat'
import AgentSessionMessageGroup from './AgentSessionMessageGroup'

const timestamp = '2026-01-01T00:00:00.000Z'
const text = {
  messages: agentText['zh-CN'].messages,
  runtimeActivity: agentText['zh-CN'].runtimeActivity,
  runtimeText: agentText['zh-CN'].runtimeText,
  input: agentText['zh-CN'].input
}

describe('AgentSessionMessageGroup', () => {
  it('marks user groups for right-aligned bubble layout', () => {
    const markup = renderToStaticMarkup(
      <AgentSessionMessageGroup
        group={group('user')}
        activeAgent={agent()}
        activeSessionId="session-1"
        activeSessionWorkspacePath="/Users/demo/project"
        chatSettings={null}
        text={text}
        onStateChange={(updater) => updater({} as never)}
        onGroupElementRef={() => undefined}
        onMessageElementRef={() => undefined}
      />
    )

    expect(markup).toContain('class="agent-message user"')
    expect(markup).toContain('class="agent-chat-bubble agent-message-bubble"')
    expect(markup).toContain('data-role="user"')
    expect(markup).toContain('class="agent-markdown"')
  })

  it('does not render an avatar or redundant user name for successful user bubbles', () => {
    const markup = renderToStaticMarkup(
      <AgentSessionMessageGroup
        group={group('user')}
        activeAgent={agent()}
        activeSessionId="session-1"
        activeSessionWorkspacePath="/Users/demo/project"
        chatSettings={null}
        text={text}
        onStateChange={(updater) => updater({} as never)}
        onGroupElementRef={() => undefined}
        onMessageElementRef={() => undefined}
      />
    )

    expect(markup).not.toContain('class="agent-message-avatar"')
    expect(markup).not.toContain('class="agent-message-meta"')
    expect(markup).not.toContain('>我</div>')
    expect(markup).not.toContain('>你</span>')
  })

  it('keeps assistant groups in the left-aligned default layout', () => {
    const markup = renderToStaticMarkup(
      <AgentSessionMessageGroup
        group={group('assistant')}
        activeAgent={agent()}
        activeSessionId="session-1"
        activeSessionWorkspacePath="/Users/demo/project"
        chatSettings={null}
        text={text}
        onStateChange={(updater) => updater({} as never)}
        onGroupElementRef={() => undefined}
        onMessageElementRef={() => undefined}
      />
    )

    expect(markup).toContain('class="agent-message"')
    expect(markup).not.toContain('class="agent-message user"')
  })

  it('renders assistant file artifacts under the message content', () => {
    const markup = renderToStaticMarkup(
      <AgentSessionMessageGroup
        group={{
          ...group('assistant'),
          messages: [
            {
              ...group('assistant').messages[0]!,
              data: {
                parts: [
                  { type: 'text', text: '已完成。' },
                  {
                    type: 'claude-sdk-tool-call',
                    toolCallId: 'write-1',
                    toolName: 'Write',
                    input: { file_path: '/Users/demo/project/hello.py', content: 'print("hi")' }
                  }
                ]
              }
            }
          ]
        }}
        activeAgent={agent()}
        activeSessionId="session-1"
        activeSessionWorkspacePath="/Users/demo/project"
        chatSettings={null}
        text={text}
        onStateChange={(updater) => updater({} as never)}
        onGroupElementRef={() => undefined}
        onMessageElementRef={() => undefined}
      />
    )

    expect(markup).toContain('agent-message-file-artifacts')
    expect(markup).toContain('已编辑 1 个文件')
    expect(markup).toContain('hello.py')
    expect(markup).toContain('打开方式')
  })
})

function group(role: AgentMessageGroup['role']): AgentMessageGroup {
  return {
    id: `${role}-message`,
    role,
    messages: [
      {
        id: `${role}-message`,
        sessionId: 'session-1',
        role,
        data: { parts: [{ type: 'text', text: role === 'user' ? '你好' : '**你好**' }] },
        searchableText: '你好',
        status: 'success',
        modelId: null,
        modelSnapshot: null,
        stats: null,
        runtimeResumeToken: null,
        createdAt: timestamp,
        updatedAt: timestamp
      } satisfies AgentSessionMessageEntity
    ]
  }
}

function agent(): AgentEntity {
  return {
    id: 'agent-1',
    type: 'claude-code',
    name: '默认助手',
    description: '',
    instructions: '',
    model: 'deepseek:deepseek-v4-pro',
    modelName: 'deepseek-v4-pro',
    mcps: [],
    disabledTools: [],
    configuration: {},
    orderKey: '0001',
    createdAt: timestamp,
    updatedAt: timestamp
  }
}
