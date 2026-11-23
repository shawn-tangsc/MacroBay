/**
 * 偏斜那条纵轴的刻度拟合：纯函数，与 ECharts 无关，单独一份好让用例单测。
 */

/**
 * 偏斜 Y 轴贴合本窗数据（界面 2026-11-22 的判据）：
 *
 * - 轴跨度**不超过数据跨度的 2 倍**（数据跨度不足 0.5 按 0.5 算，否则几个几乎同值的点会把轴压成一条）；
 * - 刻度间隔**不超过数据跨度的 1/2**；
 * - 上下界盖住数据，但不为了「凑四档」把轴撑开——第一版取整凑四档，12.8–13.2 的数据被摊到 12–15，
 *   曲线只用了六分之一高，看着还是一条平线。
 *
 * 档数因此是**结果**不是约束：小跨度 3 档、宽跨度最多 5 档；间隔取「不超过半个数据跨度」的最大整档，
 * 所以轴跨度最多是数据跨度 + 一个间隔（≤1.5 倍），永远满足 2 倍上限。
 */
export function fitSkewAxis(low: number, high: number, sparse = false): { min: number; max: number; interval: number; gridLines: number[] } {
  const dataSpan = high - low
  const span = Math.max(dataSpan, 0.5)
  const epsilon = 1e-9
  // 少于 3 个读数（攒数阶段）：点不许压在轴底或刻度线上，上下各留半档（界面 2026-11-23 定的公式）。
  //  2 个读数：间隔 = max(0.2, ceil(跨度 ÷ 2 ÷ 0.2) × 0.2)，轴 = 最小值 − 间隔/2 … 最大值 + 间隔/2。
  //  1 个读数：间隔 0.4，轴 = 值 − 0.6 … 值 + 0.6，点在正中、离最近刻度 0.2。
  // 刻度会比整档「错位半档」（7.4 / 8.6 …），这是攒数阶段的样子，不是缺陷；3 个点起走原来的拟合。
  if (sparse) {
    const single = Math.abs(dataSpan) < epsilon
    let interval = single ? 0.4 : Math.max(0.2, Math.ceil(dataSpan / 2 / 0.2 - epsilon) * 0.2)
    // 点离最近刻度至少 0.25 个间隔（界面 2026-11-23）：跨度正好是 1.5 个间隔时，高点会正好落在最后
    // 一条刻度线上（跨度 0.3 → 间隔 0.2，或跨度 0.6 → 间隔 0.4，`Math.round(2.5)` 恒取 3）。
    // 撞上就把间隔加一档再算，最多试 20 档；真撞了也不把点画在线上。
    for (let attempt = 0; attempt < 20; attempt += 1) {
      // 1 个读数上下各留 0.6（= 1.5 个间隔），2 个读数上下各留半个间隔。
      const pad = single ? interval * 1.5 : interval / 2
      const min = round1(low - pad)
      const max = round1(high + pad)
      const steps = Math.max(2, Math.round((max - min) / interval))
      const clear = [low, high].every((value) => {
        const position = (value - min) / interval
        const nearest = Math.round(position)
        return position > epsilon && position < steps - epsilon && Math.abs(position - nearest) >= 0.25 - epsilon
      })
      if (clear) {
        return {
          min,
          max: round1(min + steps * interval),
          interval: round1(interval),
          gridLines: Array.from({ length: steps }, (_, index) => round1(min + index * interval))
        }
      }
      interval = round1(interval + 0.2)
    }
    throw new Error('skew axis: could not keep readings off the tick lines')
  }
  /** 给定间隔时的对齐结果：下界向下取整到间隔，上界盖住最大值。 */
  const fitWith = (interval: number) => {
    let min = Math.floor(low / interval + epsilon) * interval
    // 读数几乎同值时，下界会被对齐到最小值本身，点就贴死在轴底；往下让一格，点落在中间才看得出「有个读数」。
    if (high - min < interval - epsilon) min -= interval
    const steps = Math.max(2, Math.ceil((high - min) / interval - epsilon))
    return { interval, min, steps, ticks: steps + 1, total: steps * interval }
  }
  // 间隔取 0.2 的整数倍（含小数档）：档数封顶 4，宁可把间隔调细/调粗到 0.2 的倍数，也不放宽到画不出线的程度。
  const candidates: number[] = []
  for (let step = 0.2; step <= 20 + epsilon; step = Math.round((step + 0.2) * 10) / 10) candidates.push(step)

  let chosen: ReturnType<typeof fitWith> | undefined
  for (const interval of candidates) {
    if (interval > span / 2 + epsilon) break
    // 先试「下界对齐到间隔整数倍」（刻度值好看），不行再试「下界只比最小值低 0.2」——
    // 后者能保住更细的间隔：满窗 11.8–15.0 用 1.2 时，对齐是 10.8 起会出 5 档，退 0.2 就是 11.6/12.8/14/15.2 四档。
    const nudgedMin = Math.round((Math.floor((low - 0.2) * 10) / 10) * 10) / 10
    const nudged = {
      interval,
      min: nudgedMin,
      steps: Math.max(2, Math.ceil((high - nudgedMin) / interval - epsilon))
    }
    const options = [fitWith(interval), { ...nudged, ticks: nudged.steps + 1, total: nudged.steps * interval }]
    const fit = options.find(candidate => candidate.ticks <= 4 && candidate.total <= span * 2 + epsilon)
    if (fit !== undefined) { chosen = fit; break }
  }
  // 极窄/极宽两端找不到「4 档 + 2 倍上限」同时成立的间隔时，先保盖住数据与 2 倍上限，档数退让。
  chosen ??= candidates.map(fitWith)
    .filter(fit => fit.total <= span * 2 + epsilon)
    .sort((a, b) => a.total - b.total)[0] ?? fitWith(candidates[candidates.length - 1]!)

  // 横虚线 = 档数 − 1：只画到倒数第二档，最上面那条边不画（Chief 2026-11-22）。
  const gridLines = Array.from({ length: chosen.steps }, (_, index) => round1(chosen!.min + index * chosen!.interval))
  return {
    min: round1(chosen.min),
    max: round1(chosen.min + chosen.steps * chosen.interval),
    interval: round1(chosen.interval),
    gridLines
  }
}


function round1(value: number): number {
  return Math.round(value * 10) / 10
}
