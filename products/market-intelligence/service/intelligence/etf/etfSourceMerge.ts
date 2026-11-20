import { etfWindowSourceIdFor } from './etfCurrentStateWindow'
import type { EtfFlowHistoryRow } from './etfFlowHistoryParser'

/**
 * 逐日合并两支流水：**同一天两个源都有值时，值相同保留旧行、值不同用主源的**；只有一边有就用那一边。
 *
 * 用户 2026-11-17：「旧源给我加回来，互相补充，新的覆盖旧的（只有数据变化的时候）」。
 *
 * 「相同」只比 `changeUsd`：同一交易日的净流是这条线唯一的事实，`sourceRevision`、抓取时间、来源标签
 * 都不参与相等性——否则一次抓取时间的差异就会让「没变的日子」也翻来源、产生一次假变更。
 * 合并结果与上一次一致 → 窗口 revision 相同 → store 的 `replace` 返回 `unchanged`。
 */
export function mergeEtfAssetDays(
  primary: readonly EtfFlowHistoryRow[] | undefined,
  standby: readonly EtfFlowHistoryRow[] | undefined
): readonly EtfFlowHistoryRow[] | undefined {
  if (!primary && !standby) return undefined
  const byDate = new Map<number, EtfFlowHistoryRow>()
  for (const row of standby ?? []) byDate.set(row.date, row)
  for (const row of primary ?? []) {
    const old = byDate.get(row.date)
    // 值一样就保留旧行（不写新行、不翻来源）；值变了才用主源这条覆盖。
    if (old !== undefined && old.changeUsd === row.changeUsd) continue
    byDate.set(row.date, row)
  }
  const merged = [...byDate.values()].sort((left, right) => left.date - right.date)
  return merged.length === 0 ? undefined : merged
}

/**
 * 给一支流水盖上「它属于哪个来源」，用的是**窗口 id**，不是采集侧的注册表 id。
 *
 * 这一步不许省：两套词表（注册表 / 窗口契约）只在 `etfWindowSourceIdFor` 里翻译一次，
 * 调用方直接把注册表 id 写进行里，整窗会被 `allowedSourceIds` 拒掉——而拒绝发生在窗口构建里，
 * 刷新层只看到 `undefined`，读者看到的是「数据不更新」（2026-11-17）。
 */
export function tagEtfSourceRows(
  rows: readonly EtfFlowHistoryRow[] | undefined,
  sourceId: string
): readonly EtfFlowHistoryRow[] | undefined {
  const source = etfWindowSourceIdFor(sourceId)
  if (rows === undefined || source === undefined) return undefined
  return Object.freeze(rows.map((row) => Object.freeze({ ...row, source })))
}

/**
 * 合并方向是**常量**：主源永远是 CryptoETF，备源永远是 0xRouter。
 *
 * 「这一轮谁被解析成主源」只管「能不能采」，不许决定谁覆盖谁：启动那几轮里排期是异步注册的，
 * 谁先注册谁就被解析成主源，方向跟着抖一次，同一份数据就能写出两个不同的窗口——而最后落库的
 * 是后到的那个（2026-11-17 启动时的现场：备源的值反而盖掉了主源）。
 */
export const etfMergePrecedence = Object.freeze(['cryptoetf-etf-flows', '0xrouter-aggregate-provider'] as const)

export type EtfSourceRows = Readonly<{
  btc?: readonly EtfFlowHistoryRow[]
  eth?: readonly EtfFlowHistoryRow[]
}>

export type EtfMergedWindow =
  | Readonly<{ state: 'available'; btc: readonly EtfFlowHistoryRow[]; eth: readonly EtfFlowHistoryRow[] }>
  | Readonly<{ state: 'partial'; btc?: readonly EtfFlowHistoryRow[]; eth?: readonly EtfFlowHistoryRow[] }>
  | Readonly<{ state: 'unavailable' }>

/**
 * 读两支、按**固定先后**合并。调用方只提供「按 id 读一支」，不提供顺序——
 * 顺序只有一个来源（`etfMergePrecedence`），所以解析器怎么抖都不会把方向调过来。
 */
export async function readMergedEtfRows(input: {
  read: (sourceId: string) => Promise<EtfSourceRows>
  onMerged?: (info: Readonly<{ primary: string; standby: string; primaryBtcDays: number; standbyBtcDays: number; mergedBtcDays: number }>) => void
}): Promise<EtfMergedWindow> {
  const [primaryId, standbyId] = etfMergePrecedence
  const primary = await input.read(primaryId)
  const standby = await input.read(standbyId)
  const btc = mergeEtfAssetDays(primary.btc, standby.btc)
  const eth = mergeEtfAssetDays(primary.eth, standby.eth)
  input.onMerged?.(Object.freeze({
    primary: primaryId,
    standby: standbyId,
    primaryBtcDays: primary.btc?.length ?? 0,
    standbyBtcDays: standby.btc?.length ?? 0,
    mergedBtcDays: btc?.length ?? 0
  }))
  if (btc && eth) return Object.freeze({ state: 'available' as const, btc, eth })
  if (btc || eth) return Object.freeze({ state: 'partial' as const, ...(btc ? { btc } : {}), ...(eth ? { eth } : {}) })
  return Object.freeze({ state: 'unavailable' as const })
}
