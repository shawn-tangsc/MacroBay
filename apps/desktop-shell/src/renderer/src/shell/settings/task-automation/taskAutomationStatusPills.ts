import type { JobScheduleView } from '@platform/jobs'
import type { ScheduledTaskEntity } from '@platform/ai/agent-platform/schemas/taskSchemas'
import type { StatusPillTone } from '@platform/ui/components/status-pill'

import type { TaskAutomationLabels } from './taskAutomationFormat'

/**
 * 任务自动化五个手写状态胶囊（`task-automation-tag*`）换成 `StatusPill` 的对照表。
 *
 * 为什么需要这张表：`StatusPill` 只收**键**（`labelKey`），不收已解析的句子；而这一屏的文案来自
 * `platformText.taskAutomation`（`labels` 已经是句子）。键只在这里出现一次，句子仍从 `labels` 取，
 * 于是「同一句话两个来源」没有发生：文案表还是唯一一份。
 *
 * 键形状按 `platform/ui/components/textKeyShape` 的判据写（点分、无空白、无中文、允许驼峰），
 * 与 `channelCatalogStatus.planned` 那批同形。
 */
export type TaskAutomationPillKey =
  | 'taskAutomation.status.active'
  | 'taskAutomation.status.paused'
  | 'taskAutomation.status.completed'
  | 'taskAutomation.outcome.success'
  | 'taskAutomation.outcome.failed'
  | 'taskAutomation.outcome.skipped'
  | 'taskAutomation.outcome.never'
  | 'taskAutomation.audit.accepted'
  | 'taskAutomation.audit.rejected'
  | 'taskAutomation.registered'
  | 'taskAutomation.unregistered'

const PILL_TEXT: Record<TaskAutomationPillKey, (labels: TaskAutomationLabels) => string> = {
  'taskAutomation.status.active': (labels) => labels.status.active,
  'taskAutomation.status.paused': (labels) => labels.status.paused,
  'taskAutomation.status.completed': (labels) => labels.status.completed,
  'taskAutomation.outcome.success': (labels) => labels.outcome.success,
  'taskAutomation.outcome.failed': (labels) => labels.outcome.failed,
  'taskAutomation.outcome.skipped': (labels) => labels.outcome.skipped,
  'taskAutomation.outcome.never': (labels) => labels.outcome.never,
  'taskAutomation.audit.accepted': (labels) => labels.auditAccepted,
  'taskAutomation.audit.rejected': (labels) => labels.auditRejected,
  'taskAutomation.registered': (labels) => labels.registered,
  'taskAutomation.unregistered': (labels) => labels.notRegistered
}

/** 交给 `StatusPill` 的解析入口：未知键返回空串（组件侧的约定），不回退键名。 */
export function pillTextResolver(labels: TaskAutomationLabels): (key: string) => string {
  return (key) => {
    const read = PILL_TEXT[key as TaskAutomationPillKey]
    return read ? read(labels) : ''
  }
}

type PillSpec = { tone: StatusPillTone; labelKey: TaskAutomationPillKey }

/** 任务自身状态：在跑=ok，暂停/完成=收起的灰（不再用无色的裸胶囊）。 */
export const TASK_STATUS_PILL: Record<ScheduledTaskEntity['status'], PillSpec> = {
  active: { tone: 'ok', labelKey: 'taskAutomation.status.active' },
  paused: { tone: 'muted', labelKey: 'taskAutomation.status.paused' },
  completed: { tone: 'muted', labelKey: 'taskAutomation.status.completed' }
}

/** 最近一次运行结果：档位与被替换的 `task-automation-tag-*` 一一对应，外观不变。 */
export const RUN_OUTCOME_PILL: Record<JobScheduleView['lastOutcome'], PillSpec> = {
  success: { tone: 'ok', labelKey: 'taskAutomation.outcome.success' },
  failed: { tone: 'bad', labelKey: 'taskAutomation.outcome.failed' },
  skipped: { tone: 'muted', labelKey: 'taskAutomation.outcome.skipped' },
  never: { tone: 'muted', labelKey: 'taskAutomation.outcome.never' }
}

/** 变更审计：「生效了没有」是一个状态词，不是动作，所以是药丸不是按钮。 */
export const AUDIT_OUTCOME_PILL: Record<'accepted' | 'rejected', PillSpec> = {
  accepted: { tone: 'ok', labelKey: 'taskAutomation.audit.accepted' },
  rejected: { tone: 'muted', labelKey: 'taskAutomation.audit.rejected' }
}

/** 资源任务注册状态：未注册 ≠ 出错，所以是灰不是红。 */
export const REGISTRATION_PILL: Record<'registered' | 'unregistered', PillSpec> = {
  registered: { tone: 'ok', labelKey: 'taskAutomation.registered' },
  unregistered: { tone: 'muted', labelKey: 'taskAutomation.unregistered' }
}
