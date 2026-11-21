/**
 * 「这个源还产出吗」的判据：**盯产出，不盯采集成功率**（2026-11-21 教训）。
 *
 * 事故当天每个采集任务都显示成功，日志全是 `25 parsed, 0 new, 25 duplicate`，而新闻已经两天没有
 * 新条目。真正该响的是两个信号，它们互不从属、必须分开报：
 *
 * - `no-output`：该源最后一次成功追加已经超过自己的正常间隔。阈值不是统一拍一个数，而是
 *   `min(48h, max(24h, 2 × p99))`，p99 用**该源自己的**追加间隔分布。样本期 11-13～11-19
 *   （正常期）、备份 + 现库共 9326 条原始记录、同一分钟内的多条算一批；下表的 p99 按这个口径量出。
 * - `normalize-failing`：同一源**连续 ≥3 次**归一化有失败，且首次失败已超过 2 小时。这次
 *   `defillama-tvl` 每 30 分钟失败一次，约 2 小时就能报——比「没产出」早得多，而且它是有产出
 *   但每条都失败，是另一种病，不能并成一条。
 *
 * 48 小时上限的理由：`binance-announcements` 正常期就有 35.67h 的静默，压到 24h 会误报；
 * 而两天正是这次事故的长度。24 小时下限：间隔再密的源，一天没产出就应该被看见。
 */
export const sourceStalenessPolicy = Object.freeze({
  floorMs: 24 * 60 * 60 * 1_000,
  capMs: 48 * 60 * 60 * 1_000,
  /** 连续失败几次算「持续失败」：30 分钟一轮，三次约 1.5 小时，避开单次抖动。 */
  normalizeFailureStreakLimit: 3,
  /** 首次失败距今超过多久才算持续：两次重试之内的抖动不算。 */
  normalizeFailureMinAgeMs: 2 * 60 * 60 * 1_000,
  /**
   * 每个源的 p99（小时），按 11-13～11-19 正常期实测；中位/p90 一并留着，半年后能复核。
   * 未列出的源按 48h 上限处理（不知道它的正常间隔，不假装知道）。
   */
  p99HoursBySource: Object.freeze({
    'coindesk-rss': { median: 0.83, p90: 4, p99: 11.05 },
    'binance-announcements': { median: 1.25, p90: 13.37, p99: 35.67 },
    'sec-rss': { median: 0, p90: 123.07, p99: 146.37 },
    'federal-reserve-rss': { median: 0, p90: 28.92, p99: 116.15 },
    'defillama-tvl': { median: 0.5, p90: 0.62, p99: 1 },
    'alternative-fear-greed': { median: 0.17, p90: 0.17, p99: 0.18 },
    'binance-spot-market': { median: 0, p90: 0.17, p99: 0.18 },
    'fred-rates-liquidity': { median: 6.63, p90: 21.65, p99: 25.82 }
  })
})

/** 闭集状态；界面各自映射一句人话，不在这里拼句子。两个病可能同时为真，所以是列表。 */
export const sourceStaleReasons = Object.freeze(['no-output', 'normalize-failing'] as const)
export type SourceStaleReason = (typeof sourceStaleReasons)[number]

/** 该源「多久没产出」的阈值：min(48h, max(24h, 2 × p99))。 */
export function stalenessThresholdMs(sourceId: string): number {
  const measured = sourceStalenessPolicy.p99HoursBySource[sourceId as keyof typeof sourceStalenessPolicy.p99HoursBySource]
  if (measured === undefined) return sourceStalenessPolicy.capMs
  const doubled = measured.p99 * 2 * 60 * 60 * 1_000
  return Math.min(sourceStalenessPolicy.capMs, Math.max(sourceStalenessPolicy.floorMs, doubled))
}

export type NormalizeStreak = Readonly<{ streak: number; firstFailureAt?: string }>

/** 从运行时状态的 checkpoint 里读归一化连续失败；字段缺失 = 0，不猜。 */
export function normalizeStreakFromCheckpoint(checkpoint: Record<string, unknown> | undefined): NormalizeStreak {
  const streak = Number(checkpoint?.normalizeFailureStreak ?? 0)
  const firstFailureAt = typeof checkpoint?.firstNormalizeFailureAt === 'string'
    ? checkpoint.firstNormalizeFailureAt
    : undefined
  return {
    streak: Number.isFinite(streak) && streak > 0 ? streak : 0,
    ...(firstFailureAt === undefined ? {} : { firstFailureAt })
  }
}

/**
 * 一次归一化后的新 checkpoint 字段：有失败就 +1（首次记时间），全部成功才清零。
 * 只返回要合并的字段，调用方保留集合检查点里的其他字段。
 */
export function normalizeStreakUpdate(input: Readonly<{
  checkpoint: Record<string, unknown> | undefined
  failed: number
  processed: number
  nowIso: string
}>): Readonly<{ normalizeFailureStreak: number; firstNormalizeFailureAt?: string }> {
  const current = normalizeStreakFromCheckpoint(input.checkpoint)
  if (input.failed > 0) {
    return {
      normalizeFailureStreak: current.streak + 1,
      firstNormalizeFailureAt: current.firstFailureAt ?? input.nowIso
    }
  }
  if (input.processed > 0) return { normalizeFailureStreak: 0 }
  return { normalizeFailureStreak: current.streak, ...(current.firstFailureAt === undefined ? {} : { firstNormalizeFailureAt: current.firstFailureAt }) }
}

/**
 * 把一次归一化的结果并回 checkpoint；清零时删掉首次失败时间，别留下孤儿字段
 * （孤儿字段会让下一条判据读到「旧的首败但 streak 已为 0」，两种病都说不清）。
 */
export function mergeNormalizeStreak(
  checkpoint: Record<string, unknown> | undefined,
  update: Readonly<{ normalizeFailureStreak: number; firstNormalizeFailureAt?: string }>
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(checkpoint ?? {}), normalizeFailureStreak: update.normalizeFailureStreak }
  if (update.firstNormalizeFailureAt === undefined) delete next.firstNormalizeFailureAt
  else next.firstNormalizeFailureAt = update.firstNormalizeFailureAt
  return next
}

/** 采集成功会整体换 checkpoint，这里把归一化字段带过去，别让一次成功把失败计数抹掉。 */
export function preserveNormalizeStreak(
  next: Record<string, unknown> | undefined,
  previous: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  const streak = normalizeStreakFromCheckpoint(previous)
  if (streak.streak === 0 && streak.firstFailureAt === undefined) return next
  return {
    ...(next ?? {}),
    ...(streak.streak > 0 ? { normalizeFailureStreak: streak.streak } : {}),
    ...(streak.firstFailureAt === undefined ? {} : { firstNormalizeFailureAt: streak.firstFailureAt })
  }
}

/**
 * 两条判据各算各的，返回闭集列表（可能两个都在）。`lastOutputAt` 缺失时**不判 no-output**：
 * 「不知道最后产出是什么时候」不等于「没产出」。
 */
export function evaluateSourceStaleness(input: Readonly<{
  sourceId: string
  /** 最后一条成功追加的产出时刻（checkpoint.lastPublishedAt）。 */
  lastOutputAt?: string
  normalize: NormalizeStreak
}>, nowMs: number): readonly SourceStaleReason[] {
  const reasons: SourceStaleReason[] = []
  if (input.lastOutputAt !== undefined) {
    const lastMs = Date.parse(input.lastOutputAt)
    if (Number.isFinite(lastMs) && nowMs - lastMs > stalenessThresholdMs(input.sourceId)) reasons.push('no-output')
  }
  const firstMs = input.normalize.firstFailureAt === undefined ? Number.NaN : Date.parse(input.normalize.firstFailureAt)
  if (
    input.normalize.streak >= sourceStalenessPolicy.normalizeFailureStreakLimit &&
    Number.isFinite(firstMs) && nowMs - firstMs >= sourceStalenessPolicy.normalizeFailureMinAgeMs
  ) {
    reasons.push('normalize-failing')
  }
  return reasons
}
