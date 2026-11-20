import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import type { DailyBriefingFactPacket } from './dailyBriefingFactPacket'
import { withRunGaps } from './dailyBriefCrossAssetGap'
import { logBriefingMacroDiagnostic } from './briefingMacroDiagnostic'

/**
 * 文档构建完成后的收口：先补这一次运行的缺口，再打这一版的宏观判定诊断。
 *
 * 两件事合在一处，因为它们都只做一次、且顺序有意义——诊断写的是**补完缺口之后**那一版文档里的
 * 原因码；反过来先打日志，再补缺口，日志里的 `macroEmpty` 就可能和读者看到的那一版不同。
 * 诊断的字段、一次一版、不带凭据这几条在 `briefingMacroDiagnostic` 里。
 */
export function finalizeRunDocument(
  document: DailyBriefingDocument,
  input: Readonly<{
    gap: Parameters<typeof withRunGaps>[1]
    packet: Pick<DailyBriefingFactPacket, 'asOf' | 'windowHours' | 'calendarFreshness'>
  }>
): DailyBriefingDocument {
  const next = withRunGaps(document, input.gap)
  logBriefingMacroDiagnostic(next, input.packet)
  return next
}
