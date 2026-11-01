export type TaskIpcScheduleValidationOptions = { now: Date; defaultTimezone: string }

/**
 * 任务 IPC 的排期校验选项：`defaultTimezone` 必须来自主进程的唯一时区提供者，
 * 不许在这里再读一次机器时区——否则用户改了时区，任务仍在机器那个小时跑。
 */
export function createTaskIpcScheduleValidationOptions(deps: {
  timeZone: () => string
  now?: () => Date
}): () => TaskIpcScheduleValidationOptions {
  const now = deps.now ?? (() => new Date())
  return () => ({ now: now(), defaultTimezone: deps.timeZone() })
}
