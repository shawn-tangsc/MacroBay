/**
 * 「把这一条再推一次手机」的**装配**（契约 §16.3.4 / 通道投递需求 §2.9）。
 *
 * 判定与投递都在 `notificationRedeliver.ts`（一句话职责：只重做一条已有记录的手机投递）；
 * 这里只负责**接线**：读同一份 state、在 runtime 的独占队列里跑、把结果写回并通知变更。
 *
 * 抽出来的原因与设置面相同：`notificationRuntime.ts` 贴着体积上限，任何新的成块逻辑
 * 都直接进独立模块，**不许先长后拆**。
 */
import type { NotificationRuntimeSettings } from '../contracts/notificationContracts'
import type { NotificationStoreState } from '../store/notificationStore'
import { redeliverPushToChannel, type RedeliverResult } from './notificationRedeliver'
import type { NotificationDeliveryContent } from './notificationRouting'
import type { NotificationRecord } from '../contracts/notificationContracts'

export type RedeliverPushInput = {
  dedupeKey: string
  editionId: string
  locale: string
  surface?: string
}

export type RedeliverSurfaceDeps = {
  getSettings: () => Promise<NotificationRuntimeSettings>
  /** 文案解析在 runtime 侧（它有语言与文案表）；这里只负责在正确的时机调用一次。 */
  resolveContent: (record: NotificationRecord) => Promise<NotificationDeliveryContent>
  pushHook?:
    | ((record: NotificationRecord, content: NotificationDeliveryContent) => Promise<{
        ok: boolean
        reason?: string
        messageId?: string
      }>)
  now: () => string
  load: () => Promise<NotificationStoreState>
  /** 整段变更排进 runtime 的队列：与记录同一份 JSON，绕开队列就会互相覆盖。 */
  exclusive: <T>(operation: () => Promise<T>) => Promise<T>
  persistWithDiagnostics: (state: NotificationStoreState) => Promise<void>
  notifyChanged: () => void
}

export function composeRedeliverSurface(deps: RedeliverSurfaceDeps) {
  return {
    /** 读者显式点击才调：不新建记录、不改内容、不动 `occurrenceCount`/`createdAt`。 */
    async redeliverPush(input: RedeliverPushInput): Promise<RedeliverResult> {
      return deps.exclusive(async () => {
        const state = await deps.load()
        const settings = await deps.getSettings()
        const now = deps.now()
        const channelId = settings.push.channelId
        const pausedUntil = channelId === null ? null : (state.pushBackoff?.[channelId]?.pausedUntil ?? null)
        const result = await redeliverPushToChannel(input, {
          records: state.records,
          now,
          channelId,
          pausedUntil,
          deliver: deps.pushHook,
          resolveContent: deps.resolveContent
        })
        if (result.kind === 'rejected') return result
        const records = state.records.map((record) =>
          record.id === result.recordId
            ? { ...record, delivery: { ...record.delivery, push: result.delivery }, updatedAt: now }
            : record
        )
        await deps.persistWithDiagnostics({ ...state, records })
        deps.notifyChanged()
        return result
      })
    }
  }
}
