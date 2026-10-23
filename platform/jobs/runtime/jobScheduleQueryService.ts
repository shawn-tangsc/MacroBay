import type { JobDefinition, JobRunQuery, JobRunRecord } from '../contracts/jobTypes'
import { projectJobSchedules, type JobScheduleView } from './jobScheduleView'

/** 只读查询面：只暴露投影后的调度视图，没有 setSchedule/removeSchedule 等写入口。 */
export type JobScheduleQueryService = {
  listSchedules: () => Promise<JobScheduleView[]>
}

export type JobScheduleReadable = {
  listSchedules: () => readonly JobDefinition[]
  listRuns: (query?: JobRunQuery) => JobRunRecord[]
}

export function createJobScheduleQueryService(deps: {
  runtime: JobScheduleReadable
  now?: () => Date
}): JobScheduleQueryService {
  return {
    async listSchedules() {
      return projectJobSchedules(deps.runtime, { now: deps.now?.() })
    }
  }
}
