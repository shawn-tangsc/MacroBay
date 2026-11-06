import { selectBaselineCandidates } from './newsSentimentAlertGate'
import type { NewsPushLedgerStore } from './newsPushLedgerStore'

/**
 * 推送开关的服务侧接口：设置页只调这两个函数，**不读账本文件**、也不自己算基线。
 *
 * 三态语义：
 * - **打开**：水位与基线在同一个事务里写（基线候选由服务端从当前条目算，调用方不传 itemId）；
 * - **关掉**：只删水位那一行，账本一行不动——推过的不再推；
 * - **再打开**：写新水位（旧的作废、不叠加），账本照旧。
 *
 * 判定点读的就是这里的状态：没有水位就是 `enabled: false`，出口用现成的 `outlet-disabled`
 * 原因码，不引入第二个「关着」的表示。
 */
export type NewsPushOutletState = Readonly<{ enabled: boolean; enabledAt?: string }>

export type NewsPushOutletService = ReturnType<typeof createNewsPushOutletService>

export function createNewsPushOutletService(deps: {
  ledger: Pick<NewsPushLedgerStore, 'readWatermark' | 'enableOutlet' | 'disableOutlet'>
  /** 当前条目（`itemId` + `publishedAt`）：基线候选由服务端算，不信调用方传进来的清单。 */
  listItems: () => ReadonlyArray<{ itemId: string; publishedAt: string }>
}) {
  return {
    /** 页面显示开关当前值只读它；没有水位就是没打开。 */
    state(): NewsPushOutletState {
      const enabledAt = deps.ledger.readWatermark()
      return enabledAt ? { enabled: true, enabledAt } : { enabled: false }
    },

    /**
     * 打开或关掉。
     *
     * `at` 是现在（ISO）：打开时它同时是水位、也是基线行的时刻；关掉时不用它。
     * 打开那一刻**先算基线再写**，两件事在 `enableOutlet` 的同一个事务里落盘——
     * 不给「基线写了一半、推送已经开始」留窗口。
     */
    setEnabled(enabled: boolean, at: string): NewsPushOutletState & { baselineWritten: number } {
      if (!enabled) {
        deps.ledger.disableOutlet()
        return { enabled: false, baselineWritten: 0 }
      }
      const baselineItemIds = selectBaselineCandidates(deps.listItems(), { now: at })
      const { baselineWritten } = deps.ledger.enableOutlet({ at, baselineItemIds })
      return { enabled: true, enabledAt: at, baselineWritten }
    }
  }
}
