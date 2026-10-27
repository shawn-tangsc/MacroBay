/**
 * 示例模式的「行情微动」。
 *
 * 只动一件事：跨资产快照里那三个**最新价**（`quotes[*].price`），在录制值上下做万分之几的随机游走，
 * 让面板看起来是活的。历史曲线、收益率、覆盖度、观测时间一个都不碰——跳的只是最后一格报价，
 * 任何回看的数字仍然来自录制。
 *
 * 这是演示层行为，不是数据生成器：它不写库、不进分析，退出示例即消失。
 */

const MAX_STEP = 0.0004

export function tickSampleQuotes(payload: unknown, random: () => number): unknown {
  if (!payload || typeof payload !== 'object') return payload
  const snapshot = payload as Record<string, unknown>
  const quotes = snapshot.quotes
  if (!quotes || typeof quotes !== 'object') return payload
  const next: Record<string, unknown> = { ...(quotes as Record<string, unknown>) }
  for (const [asset, value] of Object.entries(next)) {
    if (!value || typeof value !== 'object') continue
    const quote = value as Record<string, unknown>
    if (quote.state !== 'live' && quote.state !== 'stale') continue
    const price = Number(quote.price)
    if (!Number.isFinite(price) || price <= 0) continue
    const decimals = (String(quote.price).split('.')[1] ?? '').length
    const step = (random() - 0.5) * 2 * MAX_STEP
    next[asset] = { ...quote, price: (price * (1 + step)).toFixed(decimals) }
  }
  return { ...snapshot, quotes: next }
}
