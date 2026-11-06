import type { ChannelManagementRepository } from './ChannelManagementRepository'
import type { ChannelManagementResult } from './ChannelManagementContracts'
import type { DisplacedChannel } from './singleEnabledChannel'

/**
 * 单频道不变量的三处执行（契约 v2.20 §5.3）：启用时的清理、启动对账、恢复时的前后对账。
 *
 * 单独成一个文件：管理服务贴着 500 行硬线，而这三块都是「拿到被停用列表 → 停运行时 → 还放行 →
 * 写一行审计」的同一套动作，抽出来既不再长服务，也让审计摘要只有一个出处。
 */

type EnforcementDeps = {
  repository: ChannelManagementRepository
  runtime?: { start: (channelId: string, generation: number, ownerToken: string) => Promise<boolean | { ok: boolean; reason?: string }>; stop: (channelId: string, ownerToken?: string) => void }
  now: () => string
  releaseAcceptance: (adapter: string) => void
  reconcile?: (now: string) => { kept: DisplacedChannel | null; disabled: DisplacedChannel[] }
}

/** 启用新的频道后：旧的那条已被停用，这里停运行时、还放行、写一行「自动停用」审计。 */
export function stopDisplacedChannels(deps: EnforcementDeps, displaced: readonly DisplacedChannel[]): void {
  for (const channel of displaced) {
    deps.runtime?.stop(channel.id)
    deps.releaseAcceptance(channel.adapter)
    deps.repository.audit(channel.id, 'channel-single-enabled', 'disable', null, deps.now(), {
      auto: 'true',
      reason: 'single-channel-invariant'
    })
  }
}

/**
 * 启动对账：历史库里可能有多条启用（旧版本没有不变量，或有人直连底层 start 写过）。
 * 保留最近启用的那条，其余停用并留一行审计。
 */
export function reconcileEnabledChannels(deps: EnforcementDeps): { keptChannelId: string | null; disabledChannelIds: string[] } {
  if (!deps.reconcile) return { keptChannelId: null, disabledChannelIds: [] }
  const result = deps.reconcile(deps.now())
  stopDisplacedChannels(deps, result.disabled)
  if (result.disabled.length > 0) {
    deps.repository.audit(
      result.kept?.id ?? result.disabled[0].id,
      'channel-single-enabled',
      'update',
      null,
      deps.now(),
      { auto: 'true', reason: 'single-channel-invariant', disabled: String(result.disabled.length) }
    )
  }
  return { keptChannelId: result.kept?.id ?? null, disabledChannelIds: result.disabled.map((channel) => channel.id) }
}

/**
 * 启动恢复：对账 → 按「开启意图」逐条恢复 → 再对账。
 *
 * 为什么要跑两次：批量恢复会一条条启用，按不变量后一个会停掉前一个；
 * 不在最后再对账一次，最终留哪条就取决于恢复顺序，而不是「最近启用的那条」。
 */
export async function resumeChannelsWithInvariant(deps: EnforcementDeps & {
  resumableChannelIds: () => string[]
  readChannel: (id: string) => { state: string; type: string } | null
  /** 平台是否已声明支持：只有已声明支持的频道才走 restart（restart 没有自检放行）。 */
  canEnableAdapter: (channel: { state: string; type: string }) => boolean
  restart: (input: { id: string; actorId: string }) => Promise<ChannelManagementResult> | ChannelManagementResult
  requestEnable: (input: { id: string; actorId: string }) => Promise<ChannelManagementResult> | ChannelManagementResult
  disable: (input: { id: string; actorId: string }) => void
}): Promise<void> {
  reconcileEnabledChannels(deps)
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
  reconcileEnabledChannels(deps)
}
