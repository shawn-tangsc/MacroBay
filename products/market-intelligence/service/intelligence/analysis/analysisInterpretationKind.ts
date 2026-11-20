import type { AnalysisKind } from '../../../contracts/analysisKinds'
import type { EventGroup } from '../../../contracts/marketAnalysisContracts'
import type { MarketAnalysisRepository } from '../store/marketAnalysisRepository'

/**
 * 一个事件组的手动解读属于哪条线（R39 S1）。
 *
 * 判定只看**组与快照**，不看载荷猜：
 * - `groupType === 'sentiment'`（界面上的「消息面」）→ news；
 * - 或该组已有快照带 `trigger` 指针（R37 之后由按条解读建出来的组）→ news；
 * - 其余 → market，逐字不变。
 *
 * 卡片那条旧 IPC 与新闻写端点共用这一份，避免两处各判一次。
 */
export function interpretationKindForGroup(
  group: Pick<EventGroup, 'id' | 'groupType'>,
  repository: Pick<MarketAnalysisRepository, 'listSnapshots'>
): AnalysisKind {
  if (group.groupType === 'sentiment') return 'news'
  return repository.listSnapshots(group.id).some(snapshot => snapshot.trigger !== undefined) ? 'news' : 'market'
}
