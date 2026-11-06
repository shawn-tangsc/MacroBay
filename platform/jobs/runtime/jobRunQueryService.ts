import type { JobRunPage, JobRunQuery, JobRunRecord } from '../contracts/jobTypes'

export type JobRunQueryService = {
  getRun: (runId: string) => Promise<JobRunRecord | null>
  listRunPage: (query?: JobRunQuery) => Promise<JobRunPage>
}

type JobRunReadable = {
  getRun: (runId: string) => JobRunRecord | null | undefined
  listRunPage: (query?: JobRunQuery) => JobRunPage
}

export function createJobRunQueryService(deps: { runtime: JobRunReadable }): JobRunQueryService {
  return {
    async getRun(runId) {
      const run = deps.runtime.getRun(runId)
      return run ? cloneJobRun(run) : null
    },
    async listRunPage(query) {
      const page = deps.runtime.listRunPage(query)
      return {
        runs: page.runs.map(cloneJobRun),
        nextCursor: page.nextCursor
      }
    }
  }
}

function cloneJobRun(run: JobRunRecord): JobRunRecord {
  return {
    ...run,
    trigger: cloneJsonValue(run.trigger) as JobRunRecord['trigger'],
    payload: cloneJsonValue(run.payload),
    progress: run.progress ? { ...run.progress } : undefined,
    // 结论也复制一份：计数对象被调用方就地改掉，统计和行内显示就会各说一套。
    result: run.result ? { counts: { ...run.result.counts }, ...(run.result.reasonCode === undefined ? {} : { reasonCode: run.result.reasonCode }) } : undefined,
    logs: run.logs.map((log) => ({
      ...log,
      metadata: log.metadata ? (cloneJsonValue(log.metadata) as Record<string, unknown>) : undefined
    }))
  }
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined || value === null) return value
  return structuredClone(value)
}
