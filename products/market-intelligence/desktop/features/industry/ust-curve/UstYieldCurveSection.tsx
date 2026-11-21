import type { ReactElement } from 'react'

import type { MacroRatesSnapshotView } from '../../../../contracts/macro/macroRatesSnapshotContracts'
import { UstYieldCurveCard } from './UstYieldCurveCard'

/**
 * 市场状态区里「国债收益率」这一段的装配：把页面手上的三样事实（快照、这三格读没读完、这一格有没有被读者打开）
 * 翻成卡片的三种状态，只在这一处翻。
 *
 * 为什么要单独一层：**「还没读完」不许冒充「没启用」**（用户真机两次白屏就在这一帧）。页面把
 * `settled` 交下来，这一层负责在没读完时停在加载态；卡片自己只管画，不猜时序。
 */
export type UstYieldCurveSectionProps = Readonly<{
  view: Readonly<{ snapshot?: MacroRatesSnapshotView; state: 'loading' | 'ready' | 'unavailable' }>
  /** 启用表/源状态这一轮是否已经回来。 */
  settled: boolean
  /** 这一格（10Y 那一行）在读者设置里是否打开。 */
  enabled: boolean
  resolveText: (key: string) => string
  timeZone: string
  locale?: string
  refresh: () => void
  onEnable: () => void
}>

export function UstYieldCurveSection({
  view, settled, enabled, resolveText, timeZone, locale, refresh, onEnable
}: UstYieldCurveSectionProps): ReactElement {
  return <UstYieldCurveCard
    snapshot={view.snapshot}
    state={settled ? view.state : 'loading'}
    sourceDisabled={settled && !enabled}
    resolveText={resolveText}
    timeZone={timeZone}
    {...(locale === undefined ? {} : { locale })}
    onRefresh={refresh}
    onEnableSource={onEnable} />
}
