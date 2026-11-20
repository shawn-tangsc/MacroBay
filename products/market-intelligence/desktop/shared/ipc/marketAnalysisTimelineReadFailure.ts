/**
 * 时间轴**读不到**时的原因词汇（唯一一处）。
 *
 * 为什么要分两种：`product-runtime-unavailable` 是**情报模块本身没启动起来**（`seal-ipc-surface`
 * 对不上、注册表被置 unavailable），读者能做的是重试或重启应用；其余是「这一次没读出来」。
 * 两者对读者都是「读不到」，但**都不等于「你没有内容」**——把两者塌成同一个空形状，界面就只能
 * 把「读不到」画成「暂无」，2026-11-17 那张「暂无已发布的 AI 结论」就是这么来的。
 *
 * 放在独立模块里而不是塞回客户端：原因词汇、判定规则、返回形状是一件事，客户端只负责「调用 + 归类」。
 */

export type MarketAnalysisTimelineReadFailure = 'product-runtime-unavailable' | 'read-failed'

export type MarketAnalysisTimelineListUnavailable = Readonly<{
  state: 'unavailable'
  reason: MarketAnalysisTimelineReadFailure
}>

/** 时间轴列表的「读不到」：必须带原因，界面靠它说「模块没起来」还是「这次没读出来」。 */
export function listUnavailable(reason: MarketAnalysisTimelineReadFailure): MarketAnalysisTimelineListUnavailable {
  return { state: 'unavailable', reason }
}

/**
 * 把一次读的异常归到两种原因之一。
 *
 * 主进程在模块启动失败时抛的就是 `product-runtime-unavailable`；启动中（`booting`）与已关闭
 * （`closed`）对读者是同一个处境——模块这次不在，先重试或重启——所以归到同一档。
 * 其余异常一律 `read-failed`：不猜具体故障，但也不冒充「模块没起来」。
 */
export function readFailureReason(error: unknown): MarketAnalysisTimelineReadFailure {
  const message = error instanceof Error ? error.message : String(error)
  return /product-runtime-(unavailable|booting|closed)/.test(message) ? 'product-runtime-unavailable' : 'read-failed'
}

/** 详情读取的「读不到」：不带原因（详情那侧只说「这一条读不出来」）。 */
export function unavailable(): { state: 'unavailable' } {
  return { state: 'unavailable' }
}
