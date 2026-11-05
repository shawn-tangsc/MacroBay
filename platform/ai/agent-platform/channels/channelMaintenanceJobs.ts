import type { JobRuntime, ScheduledJobDefinition } from '@platform/jobs'

/**
 * The channel subsystem's background sweeps run as platform jobs, not as its own timers.
 *
 * Two reasons: a private interval is invisible (nobody can see whether it ran, how often, or why it
 * stopped), and scheduling rules live in one place — `@platform/jobs` — instead of once per class.
 * These are maintenance, not resources: none of them is something the user configures, so every
 * definition is `audience: 'internal'` and the settings table must not list them.
 *
 * Timers deliberately NOT here are the ones tied to a live owner and must stop with it: the
 * Telegram long-poll loop, the Slack and Lark reconnect backoff, and the inbound execution's lease
 * renewal. A scheduled job would outlive the socket or the execution and could not express "keep
 * polling this connection" or "renew this lease every few seconds". They stay per-owner timers,
 * and after this migration they are the only timers left in the channel subsystem.
 */

import { CHANNEL_DISPLAY_NAME, CHANNEL_TYPE_BY_ADAPTER_KEY } from '../../../channels/channelDisplayNames'

export const channelAdapterMaintenanceTypes = ['telegram', 'slack', 'lark', 'qq', 'discord', 'wechat'] as const
export type ChannelAdapterMaintenanceType = (typeof channelAdapterMaintenanceTypes)[number]

export const channelMaintenanceIntervalMs = 15 * 60_000
export const channelDeliveryRetryIntervalMs = 30_000

export const channelMaintenanceJobIds = {
  deliveryCleanup: 'platform.channelDeliveryCleanup',
  deliveryRetry: 'platform.channelDeliveryRetry',
  inboundRecovery: 'platform.channelInboundRecovery',
  adapterMaintenance: (type: ChannelAdapterMaintenanceType) => `platform.channelRuntimeMaintenance.${type}`
} as const

export type ChannelMaintenanceJobDependencies = {
  /** One bounded cleanup page; the cursor makes the next slice continue where this one stopped. */
  deliveryCleanup: () => void
  /** Re-drives due deliveries. */
  deliveryRetry: () => Promise<void>
  /** Reclaims expired inbound execution claims. */
  inboundRecovery: () => Promise<void>
  adapterMaintenance: Readonly<Record<ChannelAdapterMaintenanceType, () => void>>
}

export function registerChannelMaintenanceJobHandlers(
  jobRuntime: Pick<JobRuntime, 'registerHandler'>,
  deps: ChannelMaintenanceJobDependencies
): void {
  jobRuntime.registerHandler(channelMaintenanceJobIds.deliveryCleanup, async (_payload, context) => {
    deps.deliveryCleanup()
    await context.log({ level: 'debug', message: 'Channel delivery cleanup slice ran.' })
  })
  jobRuntime.registerHandler(channelMaintenanceJobIds.deliveryRetry, async () => {
    await deps.deliveryRetry()
  })
  jobRuntime.registerHandler(channelMaintenanceJobIds.inboundRecovery, async () => {
    await deps.inboundRecovery()
  })
  for (const type of channelAdapterMaintenanceTypes) {
    jobRuntime.registerHandler(channelMaintenanceJobIds.adapterMaintenance(type), async () => {
      deps.adapterMaintenance[type]()
    })
  }
}

export function channelMaintenanceJobDefinitions(
  deps: ChannelMaintenanceJobDependencies
): ScheduledJobDefinition[] {
  void deps
  return [
    {
      id: channelMaintenanceJobIds.deliveryCleanup,
      owner: 'platform',
      handlerId: channelMaintenanceJobIds.deliveryCleanup,
      title: { 'zh-CN': '清理通道投递记录', 'en-US': 'Channel delivery cleanup' },
      audience: 'internal',
      trigger: { kind: 'interval', intervalMs: channelMaintenanceIntervalMs, anchor: 'lastComplete' },
      payload: {}
    },
    {
      id: channelMaintenanceJobIds.deliveryRetry,
      owner: 'platform',
      handlerId: channelMaintenanceJobIds.deliveryRetry,
      title: { 'zh-CN': '重试失败的通道投递', 'en-US': 'Channel delivery retry' },
      audience: 'internal',
      trigger: { kind: 'interval', intervalMs: channelDeliveryRetryIntervalMs, anchor: 'lastComplete' },
      payload: {}
    },
    {
      id: channelMaintenanceJobIds.inboundRecovery,
      owner: 'platform',
      handlerId: channelMaintenanceJobIds.inboundRecovery,
      title: { 'zh-CN': '恢复通道入站消息', 'en-US': 'Channel inbound recovery' },
      audience: 'internal',
      trigger: { kind: 'interval', intervalMs: channelMaintenanceIntervalMs, anchor: 'lastComplete' },
      payload: {}
    },
    ...channelAdapterMaintenanceTypes.map((type): ScheduledJobDefinition => ({
      id: channelMaintenanceJobIds.adapterMaintenance(type),
      owner: 'platform' as const,
      handlerId: channelMaintenanceJobIds.adapterMaintenance(type),
      // 标题里的通道名取**对外名**（飞书），不是适配器键（lark）：作业名是给人看的。
      title: { 'zh-CN': '{channel} 运行时维护', 'en-US': '{channel} runtime maintenance' },
      titleParams: { channel: CHANNEL_DISPLAY_NAME[CHANNEL_TYPE_BY_ADAPTER_KEY[type]] },
      audience: 'internal' as const,
      trigger: {
        kind: 'interval' as const,
        intervalMs: channelMaintenanceIntervalMs,
        anchor: 'lastComplete' as const
      },
      payload: {}
    }))
  ]
}

/**
 * Schedules every channel maintenance job and returns the disposer that removes exactly those.
 *
 * The first pass runs inline, as the timers did: a fresh start must clean and re-drive before the
 * first interval elapses. Re-enabling is idempotent (`setSchedule` replaces), and the disposer
 * removes every definition it owns so a disabled subsystem leaves nothing registered.
 */
export function scheduleChannelMaintenanceJobs(
  jobRuntime: Pick<JobRuntime, 'setSchedule' | 'removeSchedule'>,
  deps: ChannelMaintenanceJobDependencies
): () => void {
  deps.deliveryCleanup()
  void deps.deliveryRetry()
  void deps.inboundRecovery()
  for (const type of channelAdapterMaintenanceTypes) deps.adapterMaintenance[type]()

  const definitions = channelMaintenanceJobDefinitions(deps)
  for (const definition of definitions) jobRuntime.setSchedule(definition)

  return () => {
    for (const definition of definitions) jobRuntime.removeSchedule(definition.id)
  }
}
