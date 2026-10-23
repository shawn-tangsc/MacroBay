import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import AgentRuntimeActivityPanel from './AgentRuntimeActivityPanel'

describe('AgentRuntimeActivityPanel', () => {
  it('renders one folded execution group with one row per activity', () => {
    const markup = renderToStaticMarkup(
      <AgentRuntimeActivityPanel
        cards={[
          {
            key: 'reasoning:1',
            kind: 'reasoning',
            title: '推理',
            status: 'running',
            subtitle: '正在推理',
            detail: 'Plan first.',
            approvalId: null,
            toolCallId: null
          },
          {
            key: 'tool:write',
            kind: 'tool',
            title: 'Write',
            status: 'running',
            subtitle: '工具输入已就绪',
            detail: '{ "file_path": "hello.py" }',
            approvalId: null,
            toolCallId: 'tool-write'
          },
          {
            key: 'tool:bash-1',
            kind: 'tool',
            title: 'Bash',
            status: 'running',
            subtitle: '工具输入已就绪',
            detail: 'python hello.py',
            approvalId: null,
            toolCallId: 'tool-bash-1'
          },
          {
            key: 'tool:bash-2',
            kind: 'tool',
            title: 'Bash',
            status: 'done',
            subtitle: '工具已完成',
            detail: 'hello world',
            approvalId: null,
            toolCallId: 'tool-bash-2'
          }
        ]}
        onRuntimeSnapshotChange={() => undefined}
      />
    )

    expect(markup).toContain('class="agent-runtime-activity-group execution"')
    expect(markup).not.toContain('agent-runtime-activity-group reasoning')
    expect(markup).toContain('>执行了命令<')
    expect(markup).not.toContain('共 4 条')
    expect(markup).toContain('agent-runtime-activity-group-item reasoning running')
    expect(markup).toContain('agent-runtime-activity-group-item tool running')
    expect(markup).not.toContain('class="agent-runtime-activity-card ')

    // The outer summary is the elapsed-time row; the inner group only opens on demand.
    expect(markup).toContain('>已完成<')
  })

  it('shows what each tool call did, not just its name', () => {
    const markup = renderToStaticMarkup(
      <AgentRuntimeActivityPanel
        cards={[
          {
            key: 'tool:bash',
            kind: 'tool',
            title: 'Bash',
            status: 'error',
            subtitle: 'pnpm test --filter market-intelligence',
            detail: 'Command failed: exit code 1\nstack trace follows',
            approvalId: null,
            toolCallId: 'tool-bash',
            requestDetail: '{\n  "command": "pnpm test"\n}'
          }
        ]}
        onRuntimeSnapshotChange={() => undefined}
      />
    )

    // The command sits on the row itself; the failure reason gets one line; the payload folds.
    expect(markup).toContain('>pnpm test --filter market-intelligence<')
    expect(markup).toContain('agent-runtime-activity-error')
    expect(markup).toContain('Command failed: exit code 1')
    expect(markup).toContain('>输入<')
    expect(markup).toContain('&quot;command&quot;: &quot;pnpm test&quot;')
  })

  it('nests approvals as activity rows instead of cards', () => {
    const markup = renderToStaticMarkup(
      <AgentRuntimeActivityPanel
        cards={[
          {
            key: 'tool:error',
            kind: 'tool',
            title: 'Bash',
            status: 'error',
            subtitle: '工具失败',
            detail: 'Command failed',
            approvalId: null,
            toolCallId: 'tool-error'
          },
          {
            key: 'approval:1',
            kind: 'approval',
            title: 'Write',
            status: 'pending',
            subtitle: '等待工具审批',
            detail: 'Tool call tool-write',
            approvalId: 'approval-1',
            toolCallId: 'tool-write'
          }
        ]}
        onRuntimeSnapshotChange={() => undefined}
      />
    )

    expect(markup).toContain('class="agent-runtime-activity-group execution"')
    expect(markup).toContain('class="agent-runtime-activity-group-item tool error"')
    expect(markup).toContain('class="agent-runtime-activity-group-item approval pending"')
    expect(markup).not.toContain('class="agent-runtime-activity-card ')
    expect(markup).not.toContain('class="agent-runtime-activity-group-item tool error" open=""')
  })
})
