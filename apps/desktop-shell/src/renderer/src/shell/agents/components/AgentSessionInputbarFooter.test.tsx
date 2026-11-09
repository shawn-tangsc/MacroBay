import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'

import AgentSessionInputbarFooter from './AgentSessionInputbarFooter'

const agent: AgentEntity = {
  id: 'agent-1',
  type: 'claude-code',
  name: 'test助手',
  description: 'A test agent',
  instructions: 'Help',
  model: 'tokenrhythm:deepseek-v4.1-flash-1017',
  modelName: 'deepseek-v4.1-flash-1017',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  orderKey: 'agent-1',
  configuration: { effort: 'high' }
}

const labels = {
  mentionModel: '提及模型',
  attachment: '添加附件',
  availableTools: '可用工具',
  mcpSkillsManagedInConfig: '在配置里管理',
  approval: {},
  tools: '工具',
  commands: '命令',
  collapse: '收起',
  expand: '展开',
  stop: '停止',
  send: '发送',
  removeAttachment: '移除附件'
}

function render(expanded: boolean, options: { streaming?: boolean; canSend?: boolean } = {}): string {
  return renderToStaticMarkup(
    <AgentSessionInputbarFooter
      agent={agent}
      expanded={expanded}
      toolsOpen={false}
      isStreaming={options.streaming ?? false}
      canSend={options.canSend ?? true}
      activeToolSummary=""
      builtinTools={[]}
      labels={labels}
      onToolsOpenChange={() => undefined}
      onMentionClick={() => undefined}
      onAddFiles={() => undefined}
      onToggleTool={() => undefined}
      onOpenCommands={() => undefined}
      onToggleExpanded={() => undefined}
      onStop={() => undefined}
      onSend={() => undefined}
    />
  )
}

describe('AgentSessionInputbarFooter', () => {
  it('renders the tool row through the shared icon button, not hand-written buttons', () => {
    const markup = render(false)

    // 只数按钮本体（尺寸档 `icon-button--md`），图标自己的 `icon-button__glyph` 不算。
    expect(markup.match(/icon-button--md /g) ?? []).toHaveLength(5)
    for (const name of ['提及模型', '添加附件', '工具', '命令', '展开']) {
      expect(markup).toContain(`aria-label="${name}"`)
    }
    // 工具栏那一排不再挂原生 title：悬浮提示与读屏名各挂一处会各说一份。
    const toolsRow = markup.slice(markup.indexOf('agent-inputbar-tools'), markup.indexOf('agent-inputbar-actions'))
    expect(toolsRow).not.toContain('title="')
  })

  it('keeps the send action primary while the icon button has no emphasis variant', () => {
    const idle = render(false)
    // 主操作仍是强调底色那枚：`IconButton` 只有 plain / solid / overlay，solid 是中性底，
    // 迁过去等于把主操作降成次级。这条断言随组件补上强调档一起改。
    expect(idle).toContain('agent-send-button')
    expect(idle).toContain('aria-label="发送"')

    const streaming = render(false, { streaming: true })
    // 停止已迁到图标按钮：读屏名走键、危险用 tone，不再自己铺红色。
    expect(streaming).toContain('aria-label="停止"')
    expect(streaming).toContain('icon-button--danger')
    expect(streaming).toContain('icon-button--sm')
  })

  it('keeps the send control disabled while the input cannot be sent', () => {
    const markup = render(false, { canSend: false })
    const sendButton = markup.slice(markup.indexOf('aria-label="发送"') - 200, markup.indexOf('aria-label="发送"') + 200)
    expect(sendButton).toContain('disabled')
  })

  it('names the expand control by what the next click does', () => {
    expect(render(false)).toContain('aria-label="展开"')
    expect(render(true)).toContain('aria-label="收起"')
  })
})
