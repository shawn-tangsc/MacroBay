import type { PolicyPathReading } from '../../../service/intelligence/policy-path/policyPathQueryService'
import type { productText } from '../../shared/i18n/productText'
import type { CellReadDecision } from './dashboardCellEnabled'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { calendarDisplayDate } from '../../features/macro/economic-calendar/economicCalendarDayModel'
import { ClockCardSlot } from './ClockCardSlot'
import { ExpectationPanel } from './ExpectationPanel'
import type { ExpectationSeriesEvent } from './useExpectationSeries'

type DashboardText = Readonly<{ policyPath: typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']['dashboard']['policyPath'] }>

/**
 * 看板左栏顶部那一排（用户 2026-11-15）：钟表卡 + 利率数学期望。
 *
 * 两块**内部一行不改**：钟表仍是 336×330、`transform` 为单位矩阵；期望图只换外层容器宽度
 * （内部曲线、分箱、悬停读数都还是它自己的）。这一排没有左右内距，间距只有 8。
 *
 * 两块读**同一次**读数：都由宿主传下来的那一个 `PolicyPathReading` 驱动，同一个 `asOf`。
 */
export function DashboardMacroRow({
  locale, text, now, events, facts, reading, policyUnavailable, reloadPolicy,
  probability, fed, onConfigureSources, onManageSource, onOpenDrawer, resolveKey, pending = false
}: Readonly<{
  locale: 'zh-CN' | 'en-US'
  text: DashboardText
  /** 「今天」按这里的时钟与读者时区算——两块共用同一个日期，不各取一次。 */
  now: () => Date
  events: readonly { at: string; measureKeys?: readonly string[] }[]
  facts: Parameters<typeof ClockCardSlot>[0]['facts']
  reading?: PolicyPathReading
  policyUnavailable: boolean
  reloadPolicy: () => void
  probability: CellReadDecision
  fed: CellReadDecision
  onConfigureSources: () => void
  onManageSource: Parameters<typeof ClockCardSlot>[0]['onManageSource']
  onOpenDrawer: () => void
  resolveKey: (key: string) => string
  /** 第一次读数还没回来：两块都先不画结论，也不说「读不到」。 */
  pending?: boolean
}>): React.ReactElement {
  const today = calendarDisplayDate(now().toISOString(), useShellTimeZone())
  return <div className="mi-crypto-dashboard__macro-row">
    <ClockCardSlot
      locale={locale}
      text={text}
      today={today}
      events={events}
      facts={facts}
      {...(reading === undefined ? {} : { reading })}
      policyUnavailable={policyUnavailable}
      reloadPolicy={reloadPolicy}
      probability={probability}
      fed={fed}
      onConfigureSources={onConfigureSources}
      onManageSource={onManageSource}
      onOpenDrawer={onOpenDrawer}
      resolveKey={resolveKey} />
    <ExpectationPanel
      pending={pending}
      locale={locale}
      policyText={text.policyPath}
      {...(reading === undefined ? {} : { policyReading: reading })}
      releaseEvents={events as readonly ExpectationSeriesEvent[]}
      onRetry={reloadPolicy} />
  </div>
}
