import type { AgentStoreState } from '../../ai/agent-platform/store/agentStore'
import type { AgentEntity } from '../../ai/agent-platform/schemas/agentSchemas'
import { AgentTaskDispatchService } from '../../ai/agent-platform/runtime/tasks/AgentTaskDispatchService'
import { AgentTaskExecutionCoordinator } from '../../ai/agent-platform/runtime/tasks/AgentTaskExecutionCoordinator'
import { AgentTaskSchedulerRuntimeService } from '../../ai/agent-platform/runtime/tasks/AgentTaskSchedulerRuntimeService'

/**
 * 任务运行时的装配：派发服务、排程运行时、执行协调器三者互相引用，顺序不能颠倒，
 * 所以它们必须一起装配（协调器在排程器之后创建，排程器通过 getter 反查协调器）。
 *
 * 从 `app.ts` 搬出来的原因：启动文件已经贴着体积基线，而这三者的构造关系是任务自动化自己的
 * 内部结构，不是宿主需要知道的事。搬出来只移动断言，不改任何一处依赖：`timeZone` 仍来自同一个
 * `shellTimeZone`，`subscribe` 与状态广播的回调仍是原来那两个。
 */
export type AgentTaskRuntimeWiring = {
  dispatchService: AgentTaskDispatchService
  schedulerRuntimeService: AgentTaskSchedulerRuntimeService
}

export function composeAgentTaskRuntime(deps: {
  services: ConstructorParameters<typeof AgentTaskDispatchService>[0]['services']
  runtime: ConstructorParameters<typeof AgentTaskDispatchService>[0]['runtime']
  /** 读者时区：三个消费方同源，不许各自再解析一次。 */
  timeZone: () => string
  getJobBridge: ConstructorParameters<typeof AgentTaskDispatchService>[0]['getJobBridge']
  readHeartbeat: ConstructorParameters<typeof AgentTaskDispatchService>[0]['readHeartbeat']
  deliverTaskResult: ConstructorParameters<typeof AgentTaskDispatchService>[0]['deliverTaskResult']
  getAgentState: () => Promise<AgentStoreState>
  /** 任务状态变化时的广播：先让排程器同步快照，再把新状态交给界面。 */
  publishStateChanged: (state: AgentStoreState) => void
  getExecutionCoordinator: () => AgentTaskExecutionCoordinator | null
  setExecutionCoordinator: (coordinator: AgentTaskExecutionCoordinator) => void
  startupAt: string
}): AgentTaskRuntimeWiring {
  const dispatchService = new AgentTaskDispatchService({
    services: deps.services,
    runtime: deps.runtime,
    timeZone: deps.timeZone,
    getJobBridge: deps.getJobBridge,
    readHeartbeat: deps.readHeartbeat,
    deliverTaskResult: deps.deliverTaskResult,
    onStateChanged: async () => {
      const nextState = await deps.getAgentState()
      schedulerRuntimeService.syncFromState(nextState)
      deps.publishStateChanged(nextState)
    }
  })

  const schedulerRuntimeService = new AgentTaskSchedulerRuntimeService({
    startupAt: deps.startupAt,
    getAgentState: deps.getAgentState,
    // 排程按「当地钟点」解析：`trigger.timezone` 为空 = 跟随读者设置，改设置后下一轮 reconcile 生效。
    // 与派发服务的 `timeZone` 同形、同一个来源；调度器只有一个，切片不另起。
    timeZone: deps.timeZone,
    enqueueDueTask: async (task) => {
      await deps.getExecutionCoordinator()?.enqueueDueTask(task.taskId)
    }
  })

  deps.setExecutionCoordinator(new AgentTaskExecutionCoordinator({
    services: deps.services,
    timeZone: deps.timeZone,
    dispatchQueuedRun: (input) => dispatchService.dispatchQueuedRun(input)
  }))

  return { dispatchService, schedulerRuntimeService }
}
