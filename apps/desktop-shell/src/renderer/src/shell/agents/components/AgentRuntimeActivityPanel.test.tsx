// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
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
            subtitle: 'pnpm test --filter sample-product',
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
    expect(markup).toContain('>pnpm test --filter sample-product<')
    expect(markup).toContain('agent-runtime-activity-error')
    expect(markup).toContain('Command failed: exit code 1')
    expect(markup).toContain('>输入<')
    expect(markup).toContain('&quot;command&quot;: &quot;pnpm test&quot;')
  })

  it('shows the completed duration without an activity list when the turn has no cards', () => {
    const markup = renderToStaticMarkup(
      <AgentRuntimeActivityPanel
        cards={[]}
        onRuntimeSnapshotChange={() => undefined}
        elapsedMs={65_000}
      />
    )

    expect(markup).toContain('已完成，用时 1 分 5 秒')
    expect(markup).not.toContain('agent-runtime-activity-list')
  })

  it('shows the running summary with the live elapsed time', () => {
    const markup = renderToStaticMarkup(
      <AgentRuntimeActivityPanel
        cards={[]}
        onRuntimeSnapshotChange={() => undefined}
        elapsedMs={12_000}
        running
      />
    )

    expect(markup).toContain('执行中 · 12 秒')
    expect(markup).not.toContain('agent-runtime-activity-list')
  })

  it('renders nothing without cards, failure, or elapsed time', () => {
    const markup = renderToStaticMarkup(
      <AgentRuntimeActivityPanel cards={[]} onRuntimeSnapshotChange={() => undefined} />
    )

    expect(markup).toBe('')
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

  it('auto-opens once when the turn starts running, and a manual collapse is not undone', async () => {
    // 界面设计 2026-11-09 写死：「自动展开」是**进入状态时的一次动作**，不是每次渲染都执行。
    // 读者手动收起之后，下一次渲染不许把面板重新弹开。
    const card = {
      key: 'tool:run',
      kind: 'tool' as const,
      title: 'Bash',
      status: 'running' as const,
      subtitle: '工具输入已就绪',
      detail: 'python hello.py',
      approvalId: null,
      toolCallId: 'tool-run'
    }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const panel = () => (
      <AgentRuntimeActivityPanel cards={[card]} onRuntimeSnapshotChange={() => undefined} running />
    )
    await act(async () => { root.render(panel()) })

    const header = (): HTMLElement => host.querySelector<HTMLElement>('.ant-collapse-header')!
    expect(header().getAttribute('aria-expanded')).toBe('true')

    await act(async () => { header().click() })
    expect(header().getAttribute('aria-expanded')).toBe('false')

    // 仍是 running 的另一次渲染：不许把它弹回去。
    await act(async () => { root.render(panel()) })
    expect(header().getAttribute('aria-expanded')).toBe('false')

    await act(async () => { root.unmount() })
    host.remove()
  })
})
