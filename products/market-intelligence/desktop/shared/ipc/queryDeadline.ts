/**
 * 读口期限：一次读**永不 settle** 时，界面不许一直转。
 *
 * 为什么需要它：本地 IPC + SQLite 的正常读是毫秒级；失败路径各家自己的退避（例如资金面
 * `400 + 1200ms` 两跳）在 1.6 秒内就把「失败」判完了。剩下没落定的，只可能是**挂起**
 * （IPC 没回、promise 不 settle）——那是「状态永不落定」，比报错更糟：读者连「等久一点」
 * 和「已经坏了」都分不出来。
 *
 * 10 秒的依据：正常读的一个量级以上，也明显长于上面那套失败判定；同时短于读者开始怀疑
 * 「这软件坏了 / 我要重开界面」的量级（15 秒勉强可接受，30 秒已经是重开界面的心理阈值）。
 *
 * 形状：包住一次读的 promise，超时以 `QueryDeadlineError` 拒绝；调用方按**自己的既有失败分支**
 * 处理（资金面那边折成 `unavailable` + `reason: 'timeout'`，可见文案仍复用「这次没读出来」，
 * **不加新句**——「失败」和「超时」对读者是同一件事实，差别只在诊断里有用）。
 */
export const queryReadDeadlineMs = 10_000

/** 超时的专用错误：调用方用它把 `timeout` 与真正的失败区分开（诊断用，不新增可见文案）。 */
export class QueryDeadlineError extends Error {
  readonly code = 'query-deadline'

  constructor(deadlineMs: number) {
    super(`read did not settle within ${deadlineMs}ms`)
    this.name = 'QueryDeadlineError'
  }
}

/**
 * 挂 deadline 的那一次读。
 *
 * 计时器随 promise 结束一起清掉（成功或失败都不留悬挂 timer，假时钟下也不会漏一拍）。
 */
export function withQueryDeadline<T>(read: Promise<T>, deadlineMs: number = queryReadDeadlineMs): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new QueryDeadlineError(deadlineMs)) }, deadlineMs)
    read.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) }
    )
  })
}

/**
 * 同形状读口清单（都直接 `await client.*`，都没有 deadline）——**已接 / 未接**写在这里，
 * 下一笔按顺序接，不要再把所有 hook 扫一遍。
 *
 * **全部已接**（2026-11-13，用户 0.4.4 拍板；守卫在 `pages/intelligence/queryDeadlineReadPoints.test.tsx`，
 * 每个读口一条「桩永不返回 → 过 deadline 落终态」的用例，新增读口照此加一条）：
 * 1. 资金面 `useCapitalConditions` → `querySnapshot`
 * 2. `useDashboardOpenInterest`（`client.query`；信号腿失败本就可容忍，不另加）
 * 3. `useDashboardFundingRateHistory`（`client.query`）
 * 4. `useDashboardFearGreed`（`client.querySnapshot`）
 * 5. `useDashboardDivergence`（`client.query`）
 * 6. `useDashboardEconomicCalendar`（`client.queryMonth`）
 * 7. `useCalendarCardData`（两条日历读）
 * 8. `useMacroMarketSnapshot`（`client.query`）
 * 9. `useMacroRatesSnapshot`（`client.query`）
 * 10. 跨资产 `useCrossAssetObservation`（`client.query`）
 *
 * 两条读口另有「不许无限加载」的上限（不只 deadline）：`useMacroMarketSnapshot` /
 * `useMacroRatesSnapshot` 在**首答之前连续 3 轮没有答案**就落 `unavailable`（有数据后保持旧行，
 * 轮询继续、恢复即回 ready）。理由：这两个是轮询式读口，光给每次读挂 10 秒期限，状态仍可能永远
 * 停在「加载中」。
 */
