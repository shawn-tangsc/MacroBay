import type { JobRunQueryService, JobRuntime } from '../../jobs'
import type { TaskActor } from '../../ai/agent-platform/runtime/tasks/taskAutomationContracts'

type AgentTaskRunControllerDependencies = {
  jobs: JobRunQueryService
  jobRuntime: Pick<JobRuntime, 'cancel'>
}

export type AgentTaskRunController = {
  cancelTaskRun: (input: string | { runLogId: string; actor: Extract<TaskActor, { kind: 'agent' }> }) => Promise<{
    runLogId: string
    jobRunId: string | null
    cancelled: boolean
  }>
}

export function createAgentTaskRunController(
  deps: AgentTaskRunControllerDependencies
): AgentTaskRunController {
  return {
    async cancelTaskRun(input) {
      const runLogId = typeof input === 'string' ? input : input.runLogId
      const page = await deps.jobs.listRunPage({
        owner: 'platform',
        handlerId: 'platform.agent.task.run',
        statuses: ['queued', 'running'],
        payload: { runLogId },
        limit: 1
      })
      const run = page.runs[0]
      if (!run) {
        return {
          runLogId,
          jobRunId: null,
          cancelled: false
        }
      }

      deps.jobRuntime.cancel(run.id, {
        kind: 'cancelled',
        message: 'Cancelled by user.'
      })
      return {
        runLogId,
        jobRunId: run.id,
        cancelled: true
      }
    }
  }
}
