import type { AgentTaskExecutionCoordinator } from '../../../ai/agent-platform/runtime/tasks'
import type { JobRuntime } from '../../../jobs'
import type { createProductIpcRegistry } from '../../ipc/productIpcRegistry'
import type { composePanelWorkspace } from '../workspace/composePanelWorkspace'
import type { createAgentTaskRunController } from '../agentTaskRunController'

/**
 * 退出期与启动期的**可变状态槽**。它们是 `app.ts` 里跨阶段读写的那几个 `let`。搬家时不能跟着模块走
 * （import 的绑定对导入方只读），所以收进这里：`app.ts` 用 setter 写、任何模块用 getter 读。
 * 受保护接缝（`setName` / `userData` / 验收画像 / 夹具）**不在这里**，仍在原地。
 *
 * `agentTaskExecutionCoordinator` 的读取发生在构造期（任务桥要拿它），所以它的 getter **未初始化即抛**：
 * 静默拿到 `undefined` 会让任务桥用空协调器建起来，比抛错糟得多。
 */

let agentTaskExecutionCoordinator: AgentTaskExecutionCoordinator | null = null
let jobRuntimeForDisposal: JobRuntime | null = null
let productIpcRegistryForDisposal: ReturnType<typeof createProductIpcRegistry> | null = null
let panelWorkspaceForDisposal: ReturnType<typeof composePanelWorkspace> | null = null
let disposeTaskAutomationMaintenance: (() => void) | null = null
let disposeJobRunRetention: (() => void) | null = null
let disposeChannelMaintenanceJobs: (() => void) | null = null
let installedProductManifestIds: string[] = []
let agentTaskRunController: ReturnType<typeof createAgentTaskRunController> | null = null
/** 通道运行审计的批量裁剪（0.4.3 B3）：由通道组合根设置，保留期任务读取。 */
let channelRuntimeAuditPrune: (() => { removedFailureRows: number; removedLifecycleRows: number }) | null = null
/** 入站附件字节的内容寻址 store（0.4.5）：repositories 建一次，通道分片与将来的清理作业读同一个实例。 */
let channelAttachmentBlobStore: ChannelAttachmentBlobStoreHandle | null = null

type ChannelAttachmentBlobStoreHandle = ReturnType<typeof import('../../../storage/contentAddressedBlobs').createContentAddressedBlobStore>

export function setChannelAttachmentBlobStore(value: ChannelAttachmentBlobStoreHandle): void {
  channelAttachmentBlobStore = value
}

/** 未初始化即抛：静默拿到 `undefined` 会让入站附件以为「写成功了」。 */
export function getChannelAttachmentBlobStore(): ChannelAttachmentBlobStoreHandle {
  if (channelAttachmentBlobStore === null) throw new Error('channel-attachment-blob-store-before-init')
  return channelAttachmentBlobStore
}

export function setAgentTaskExecutionCoordinator(value: AgentTaskExecutionCoordinator | null): void {
  agentTaskExecutionCoordinator = value
}

export function getAgentTaskExecutionCoordinator(): AgentTaskExecutionCoordinator {
  if (agentTaskExecutionCoordinator === null) throw new Error('agent-task-execution-coordinator-before-init')
  return agentTaskExecutionCoordinator
}

export function getAgentTaskExecutionCoordinatorOrNull(): AgentTaskExecutionCoordinator | null {
  return agentTaskExecutionCoordinator
}

export function setJobRuntimeForDisposal(value: JobRuntime | null): void { jobRuntimeForDisposal = value }
export function getJobRuntimeForDisposal(): JobRuntime | null { return jobRuntimeForDisposal }

export function setProductIpcRegistryForDisposal(value: ReturnType<typeof createProductIpcRegistry> | null): void {
  productIpcRegistryForDisposal = value
}
export function getProductIpcRegistryForDisposal(): ReturnType<typeof createProductIpcRegistry> | null {
  return productIpcRegistryForDisposal
}

export function setPanelWorkspaceForDisposal(value: ReturnType<typeof composePanelWorkspace> | null): void {
  panelWorkspaceForDisposal = value
}
export function getPanelWorkspaceForDisposal(): ReturnType<typeof composePanelWorkspace> | null {
  return panelWorkspaceForDisposal
}

export function setDisposeTaskAutomationMaintenance(value: (() => void) | null): void {
  disposeTaskAutomationMaintenance = value
}
export function getDisposeTaskAutomationMaintenance(): (() => void) | null {
  return disposeTaskAutomationMaintenance
}

export function setDisposeJobRunRetention(value: (() => void) | null): void { disposeJobRunRetention = value }
export function getDisposeJobRunRetention(): (() => void) | null { return disposeJobRunRetention }

export function setDisposeChannelMaintenanceJobs(value: (() => void) | null): void { disposeChannelMaintenanceJobs = value }
export function getDisposeChannelMaintenanceJobs(): (() => void) | null { return disposeChannelMaintenanceJobs }

export function setInstalledProductManifestIds(value: string[]): void { installedProductManifestIds = value }
export function getInstalledProductManifestIds(): string[] { return installedProductManifestIds }

export function setAgentTaskRunController(value: ReturnType<typeof createAgentTaskRunController> | null): void {
  agentTaskRunController = value
}
export function getAgentTaskRunController(): ReturnType<typeof createAgentTaskRunController> | null {
  return agentTaskRunController
}

export function setChannelRuntimeAuditPrune(value: (() => { removedFailureRows: number; removedLifecycleRows: number }) | null): void {
  channelRuntimeAuditPrune = value
}

/** 保留期任务在注册时就该有它：拿不到说明组合根漏了接线，宁可注册期失败也不静默不裁。 */
export function getChannelRuntimeAuditPrune(): () => { removedFailureRows: number; removedLifecycleRows: number } {
  if (channelRuntimeAuditPrune === null) throw new Error('channel-runtime-audit-prune-before-init')
  return channelRuntimeAuditPrune
}
