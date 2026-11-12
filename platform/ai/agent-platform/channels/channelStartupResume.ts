import type { ChannelManagementResult } from './ChannelManagementContracts'
import type { ChannelManagementRepository } from './ChannelManagementRepository'

/**
 * 启动恢复：只按**读者的开启意图**逐条恢复，不做「保留最近启用那一条」的对账。
 *
 * 为什么去掉对账：「同一时间只允许一条频道启用」这个不变量已经拆了（多频道方案 §1b），
 * 启动时再按旧规则收口，等于把读者刚启用的第二条在下次启动时静默关掉——那正是要拆掉的行为。
 *
 * 两条边界：
 * - **只恢复 `requested_enabled = 1` 的通道**。被旧规则停用过的那条意图已被清零，它不在这份候选里，
 *   所以不会被自动打开（自动改读者状态是另一回事，提示在方案第 3 笔）。
 * - 瞬时失败（自检没过、运行时没起来）保留意图，下次启动再试；只有凭据缺失/失效、频道不存在这类
 *   确定性问题才停用这条——把「这次没连上」当成「读者不想用」，会让读者每次启动都要重点一次。
 */
export type ChannelStartupResumeDeps = {
  repository: ChannelManagementRepository
  /** 与别处同一个时钟（`ChannelManagementService.now()`），不在这里另取一个时间。 */
  now: () => string
  resumableChannelIds: () => string[]
  readChannel: (id: string) => { state: string; type: string } | null
  /** 平台是否已声明支持：只有已声明支持的频道才走 restart（restart 没有自检放行）。 */
  canEnableAdapter: (channel: { state: string; type: string }) => boolean
  restart: (input: { id: string; actorId: string }) => Promise<ChannelManagementResult> | ChannelManagementResult
  requestEnable: (input: { id: string; actorId: string }) => Promise<ChannelManagementResult> | ChannelManagementResult
  disable: (input: { id: string; actorId: string }) => void
}

export async function resumeRequestedChannels(deps: ChannelStartupResumeDeps): Promise<void> {
  for (const id of deps.resumableChannelIds()) {
    const channel = deps.readChannel(id)
    const result = channel !== null && channel.state === 'runtime-ready' && deps.canEnableAdapter(channel)
      ? await deps.restart({ id, actorId: 'channel-startup' })
      // 没声明支持的平台走启用那条路：它带「现场自检通过就只启用这一条」的放行，
      // 否则一条靠自检启用的频道每次重启都要读者再点一次（用户 2026-11-04 报的 bug）。
      // 先把状态归一成 `ready`：退出时只围栏了运行代际，频道仍是 `enabled`，
      // 而「启用」这条路的 owner 只接受 ready/disabled，直接调会被当成「已经在跑」而不启动。
      : (deps.repository.preserveResumeIntent(id, deps.now()), await deps.requestEnable({ id, actorId: 'channel-startup' }))
    if (!result.ok) {
      // 瞬时失败（自检没过、运行时没起来）保留开启意图，下次启动再试；
      // 只有凭据缺失/失效、频道不存在这类确定性问题才清掉意图。
      if (result.code === 'adapter-runtime-start-failed' || result.code === 'channel-smoke-failed') {
        deps.repository.preserveResumeIntent(id, deps.now())
      } else {
        deps.disable({ id, actorId: 'channel-startup' })
      }
    }
  }
}
