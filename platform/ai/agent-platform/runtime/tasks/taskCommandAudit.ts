import { createHash, randomUUID } from 'node:crypto'

import type { ScheduledTaskEntity } from '../../schemas/taskSchemas'
import type { AgentStoreState } from '../../store/agentStore'
import type { TaskAutomationCommand, TaskMutationAuditEntity } from './taskAutomationContracts'

/**
 * 把一条命令写成一行审计。
 *
 * 从 `TaskAutomationCommandService` 抽出来的原因：它只做「命令 + 目标 + 结果 → 审计实体」这一件
 * 纯整形的事，和命令的执行流程没有关系；留在那个类里既把文件顶到体积上限，也让审计行的形状
 * 淹没在业务分支里。**没有行为变化**：同一条命令、同一个时刻，产出的行逐字段相同。
 */
export type CancelRunAuditCommand = {
  actor: Extract<TaskAutomationCommand['actor'], { kind: 'agent' }>
  agentId: string
  taskId: string
  runLogId: string
  expectedRevision: number
}

type AuditTaskRef = Pick<ScheduledTaskEntity, 'id' | 'name' | 'revision'> | null

function requestHashOf(command: unknown): string {
  return createHash('sha256').update(JSON.stringify(command)).digest('hex')
}

/** 命令目标在审计那一刻的落点：删/改要找得到那条任务，创建则没有。 */
export function findAuditTask(
  state: AgentStoreState,
  command: TaskAutomationCommand
): ScheduledTaskEntity | null {
  if (command.type === 'create') return null
  return state.tasks.find((item) => item.id === command.taskId && item.agentId === command.agentId) ?? null
}

export function createCommandAudit(input: {
  command: TaskAutomationCommand
  task: AuditTaskRef
  outcome: TaskMutationAuditEntity['outcome']
  errorCode: string | null
  createdAt: string
}): TaskMutationAuditEntity {
  const { command, task, outcome, errorCode, createdAt } = input
  return {
    id: randomUUID(),
    taskId: task?.id ?? (outcome === 'accepted' && command.type !== 'create' ? command.taskId : null),
    agentId: command.agentId,
    taskNameSnapshot: task?.name ?? (command.type === 'create' ? command.task.name : null),
    action: command.type,
    actor: command.actor,
    requestHash: requestHashOf(command),
    resultRevision: outcome === 'accepted' ? task?.revision ?? null : null,
    createdAt,
    outcome,
    errorCode
  }
}

export function createCancelRunAudit(input: {
  command: CancelRunAuditCommand
  task: AuditTaskRef
  outcome: TaskMutationAuditEntity['outcome']
  errorCode: string | null
  createdAt: string
}): TaskMutationAuditEntity {
  const { command, task, outcome, errorCode, createdAt } = input
  return {
    id: randomUUID(),
    taskId: task?.id ?? null,
    agentId: command.agentId,
    taskNameSnapshot: task?.name ?? null,
    action: 'cancel-run',
    actor: command.actor,
    requestHash: requestHashOf(command),
    resultRevision: outcome === 'accepted' ? task?.revision ?? null : null,
    createdAt,
    outcome,
    errorCode
  }
}
