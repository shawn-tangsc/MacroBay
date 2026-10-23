import { renderToStaticMarkup } from 'react-dom/server'

import { describe, expect, it, vi } from 'vitest'

import { agentTextEnWorkbench } from '../agentTextEnWorkbench'
import { agentTextZhWorkbench } from '../agentTextZhWorkbench'
import { buildDefaultAgentTaskDraft } from '../agentTaskCenterViewModel'
import AgentTaskDraftForm from './AgentTaskDraftForm'

describe('AgentTaskDraftForm', () => {
  it('renders the schedule preview in English', () => {
    const markup = renderToStaticMarkup(
      <AgentTaskDraftForm
        draft={buildDefaultAgentTaskDraft({ type: 'system' })}
        workspaces={[]}
        saving={false}
        editing={false}
        disabled={false}
        schedulePreview={{ ok: true, nextRunAt: '2026-07-17T09:00:00.000Z' }}
        labels={agentTextEnWorkbench.taskCenter}
        onDraftChange={vi.fn()}
        onSave={vi.fn()}
        onCancelCreate={vi.fn()}
      />
    )

    expect(markup).toContain('Next run: 2026-07-17 09:00')
  })

  it('renders Chinese completed drafts as immutable controls', () => {
    const markup = renderToStaticMarkup(
      <AgentTaskDraftForm
        draft={buildDefaultAgentTaskDraft({ type: 'system' })}
        workspaces={[]}
        saving={false}
        editing
        disabled
        schedulePreview={{ ok: false, code: 'task-timezone-invalid' }}
        labels={agentTextZhWorkbench.taskCenter}
        onDraftChange={vi.fn()}
        onSave={vi.fn()}
        onCancelCreate={vi.fn()}
      />
    )

    expect(markup).toContain('Cron 时区无效。')
    expect(inputForPlaceholder(markup, agentTextZhWorkbench.taskCenter.namePlaceholder)).toContain('disabled')
  })
})

function inputForPlaceholder(markup: string, placeholder: string): string {
  const index = markup.indexOf(`placeholder="${placeholder}"`)
  const start = markup.lastIndexOf('<input', index)
  const end = markup.indexOf('>', index)
  return start === -1 || end === -1 ? '' : markup.slice(start, end + 1)
}
