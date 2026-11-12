import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 启动顺序：**会在界面上体现状态**的恢复必须在渲染器挂载之前跑完，纯后台的留在之后。
 *
 * 为什么钉在源码顺序上：这不是一条可以靠单元测试跑出来的时间关系（`bootstrapDesktopApp` 要真起
 * Electron）。而顺序错了的后果很具体——2026-11-13 把整段后台恢复挪到挂载之后时，首帧读到的会是
 * 旧状态：通道显示「未运行」、任务运行记录显示「运行中」、MCP 工具列表缺项、在用模型巡检没有标记；
 * 其中任务自动化页 mount 后不订阅变化，所以它**不会自己纠正**，比闪一下更糟。
 *
 * 判据（每处一条）：
 * - 通道：`recover` / `bootChannelRuntimes` / `resumeRequested` 都在挂载之前；
 * - 任务运行记录：`recoverAfterRestart`（把重启前的 running/queued 收成 cancelled）在挂载之前；
 * - 工具/MCP：三个 `syncFromState` 在挂载之前；
 * - 在用模型巡检：handler 注册与排期同步在挂载之前；
 * - 纯后台（保留期与维护排期、运行时订阅、菜单）留在挂载之后。
 */

const source = readFileSync(join(process.cwd(), 'platform/desktop/main/app.ts'), 'utf8')
const mount = source.indexOf('await mainWindowHost.loadAndMount()')

function indexOfOnce(marker: string): number {
  const index = source.indexOf(marker)
  expect(index, `app.ts 里找不到这段：${marker}`).toBeGreaterThanOrEqual(0)
  // 只出现一次：两处同名调用会让「谁在挂载前」变得说不清。
  expect(source.indexOf(marker, index + marker.length), `${marker} 出现了不止一次`).toBe(-1)
  return index
}

function expectBeforeMount(marker: string): void {
  expect(indexOfOnce(marker), `${marker} 必须在 loadAndMount 之前`).toBeLessThan(mount)
}

function expectAfterMount(marker: string): void {
  expect(indexOfOnce(marker), `${marker} 应该留在 loadAndMount 之后`).toBeGreaterThan(mount)
}

describe('boot order: state the first screen reads is settled before the renderer loads', () => {
  it('finds the mount point', () => {
    expect(mount).toBeGreaterThan(0)
  })

  it('settles channel runtime before the mount, so the channel page never reads "not running" first', () => {
    expectBeforeMount('await channelManagementService.recover()')
    expectBeforeMount('await bootChannelRuntimes({')
    expectBeforeMount('await channelManagementService.resumeRequested()')
  })

  it('settles task run records before the mount, because that page does not refresh by itself', () => {
    expectBeforeMount('await getAgentTaskExecutionCoordinatorOrNull()?.recoverAfterRestart()')
    expectBeforeMount('taskAutomationMaintenance.recoverAfterRestart()')
  })

  it('settles the tool and MCP runtime state before the mount', () => {
    expectBeforeMount('syncProductToolsRuntimeFromState(await agentStore.getState())')
    expectBeforeMount('mcpRuntimeService.syncFromState(await agentStore.getState())')
    expectBeforeMount('agentTaskSchedulerRuntimeService.syncFromState(await agentStore.getState())')
  })

  it('registers and schedules the in-use model patrol before the mount', () => {
    expectBeforeMount('registerInUseModelPatrolHandler(jobRuntime, { patrol: inUseModelPatrol })')
    expectBeforeMount('await syncInUseModelPatrolSchedule(jobRuntime, {')
  })

  it('leaves only background scheduling and subscriptions after the mount', () => {
    expectAfterMount('setDisposeTaskAutomationMaintenance(scheduleTaskAutomationMaintenance(taskAutomationMaintenance))')
    expectAfterMount('setDisposeJobRunRetention(scheduleJobRunRetention(jobRunStore))')
    expectAfterMount('setDisposeChannelMaintenanceJobs(scheduleChannelMaintenanceJobs(jobRuntime, channelMaintenanceJobDeps))')
    expectAfterMount('agentTaskSchedulerRuntimeService.start()')
    expectAfterMount('agentRuntimeService.subscribe((snapshot) => {')
    expectAfterMount('buildAppMenu(getMainWindow)')
  })
})
