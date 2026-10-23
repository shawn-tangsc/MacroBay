import type { IpcMain } from 'electron'

import type { JobRunQuery, JobRunQueryService, JobScheduleQueryService } from '../../jobs'
import { IpcChannels } from '../ipc/channels'

export function registerJobIpcHandlers(
  ipcMain: Pick<IpcMain, 'handle'>,
  jobs: JobRunQueryService,
  schedules: JobScheduleQueryService
): void {
  ipcMain.handle(IpcChannels.jobsGetRun, (_event, runId: string) => jobs.getRun(runId))
  ipcMain.handle(IpcChannels.jobsListRunPage, (_event, query?: JobRunQuery) => jobs.listRunPage(query))
  ipcMain.handle(IpcChannels.jobsListSchedules, () => schedules.listSchedules())
}
