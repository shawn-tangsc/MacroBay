import { useEffect, useState } from 'react'

import type { ScheduledTaskEntity } from '@platform/ai/agent-platform/schemas/taskSchemas'
import type { TaskSchedulePreview } from '@platform/ai/agent-platform/runtime/tasks/taskScheduleValidation'

import { buildTaskTriggerFromDraft, type AgentTaskDraft } from '../agentTaskCenterViewModel'
import { previewTaskScheduleViaApi } from '../agentTaskDataApi'

export function useAgentTaskRuntimeSignals(input: {
  agentId: string
  draft: AgentTaskDraft
  selectedTask: ScheduledTaskEntity | null
}): { schedulePreview: TaskSchedulePreview | null } {
  const [schedulePreview, setSchedulePreview] = useState<TaskSchedulePreview | null>(null)

  useEffect(() => {
    const trigger = buildTaskTriggerFromDraft(input.draft)
    if (!trigger.ok) {
      setSchedulePreview(null)
      return
    }
    let active = true
    void previewTaskScheduleViaApi(window.platform, trigger.trigger)
      .then((preview) => {
        if (active) setSchedulePreview(preview)
      })
      .catch(() => {
        if (active) setSchedulePreview({ ok: false, code: 'task-schedule-invalid' })
      })
    return () => {
      active = false
    }
  }, [input.draft.triggerKind, input.draft.intervalMinutes, input.draft.onceAt, input.draft.cronExpr, input.draft.timezone])

  return { schedulePreview }
}
