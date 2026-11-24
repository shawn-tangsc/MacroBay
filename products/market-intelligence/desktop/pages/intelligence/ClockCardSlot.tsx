import { ErrorBoundary } from '@platform/ui/components/error-boundary'
import { createPortal } from 'react-dom'

import type { productText } from '../../shared/i18n/productText'
import type { CellReadDecision } from './dashboardCellEnabled'
import { dashboardCellId } from './dashboardCellEnabled'
import { ClockCard } from './ClockCard'
import { buildClockCardModel } from './clockCardModel'
import { clockScheduleMetrics } from './clockScheduleMetrics'
import { clockCardText } from './clockCardText'

type DashboardText = typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']['dashboard']
/** 这里只用到政策路径那几句文案；收窄到用到的部分，免得为了它把整份看板文案传进来。 */
type PolicyPathCopy = DashboardText['policyPath']
type ClockSourceEvent = Readonly<{ at: string; measureKeys?: readonly string[] }>
type ClockFact = Parameters<typeof clockScheduleMetrics>[0]['facts'][number]

/**
 * 右栏顶部那一格：钟表卡 + 它的政策降级说明。
 *
 * 从看板主文件里抽出来，只搬**这一格自己的计算**——角度/透明度/撞牌仍在 `clockCardModel`，
 * 这里做的是「把三份数据拼成卡的输入」：日程（日期与周期 P）、卡片读数（值）、政策读数（会议与概率）。
 *
 * 三支政策状态（未启用哪一格 / 源自己关着 / 整块读不到）也在这里成句，句子仍来自文案表，
 * 判断只有一处——不在卡里另判一次。
 */
export function ClockCardSlot({
  locale, text, today, nowIso, events, facts, reading: input_reading, policyUnavailable, reloadPolicy,
  probability, fed, onConfigureSources, onManageSource, onOpenDrawer, resolveKey, slot
}: Readonly<{
  locale: 'zh-CN' | 'en-US'
  text: Readonly<{ policyPath: PolicyPathCopy }>
  /** 显示时区的「今天」（`YYYY-MM-DD`）。 */
  today: string
  /** 此刻的 ISO 时刻：中央 ±24 小时窗口按它算（与 `today` 取自同一次）。 */
  nowIso: string
  events: readonly ClockSourceEvent[]
  facts: readonly ClockFact[]
  /** 政策读数**已读到时**的那份（会议日 + 盘口概率）；读不到或没启用时不给。 */
  reading?: Readonly<{ meetingDate: string
    probability?: Readonly<{ value: number; outcome?: string }> }> | undefined
  policyUnavailable: boolean
  reloadPolicy: () => void
  probability: CellReadDecision
  fed: CellReadDecision
  onConfigureSources: () => void
  onManageSource: (focus: Readonly<{ business: 'dashboard'; moduleKey: 'policy-path'; cellId: string }>) => void
  onOpenDrawer: () => void
  resolveKey: (key: string) => string
  /** 右栏那一格的挂点：给了就 portal 过去（页面层级不再被撑开）。 */
  slot?: HTMLDivElement | null
}>): React.ReactElement {
  const reading = input_reading
  // 牌宽随名字走：布局要按解析后的名字估盒子，「两块叠了多少」才算得出来（`clockPlaqueBox`）。
  const cardText = clockCardText[locale]
  // 看板首屏的一块：崩了就只换这一块（`ErrorBoundary` 的 error 态 + 重试），不把整页带走。
  return <SlotHost slot={slot}>{<ErrorBoundary scope="macro-clock-card">
    <ClockCard
    model={buildClockCardModel({
      today,
      now: nowIso,
      names: cardText.names,
      categoryNames: cardText.categories,
      metrics: clockScheduleMetrics({
        today,
        events: events.map((event) => ({
          scheduledAt: event.at,
          ...(event.measureKeys === undefined ? {} : { measureKeys: event.measureKeys })
        })),
        facts,
        ...(reading === undefined ? {} : {
          policy: {
            meetingDate: reading.meetingDate,
            ...(reading.probability === undefined ? {} : { probability: {
              value: reading.probability.value,
              ...(reading.probability.outcome === undefined ? {} : { outcome: reading.probability.outcome })
            } })
          }
        })
      })
    })}
    text={cardText}
    actionLabelKey="pages.intelligence.portal.calendarCard.openCalendar"
    onOpenDetail={onOpenDrawer}
    onOpenCalendar={onOpenDrawer}
    resolveText={resolveKey}
    {...policyPresentation({ text, probability, fed, unavailable: policyUnavailable, reloadPolicy, onConfigureSources, onManageSource, resolveKey })}
    />
  </ErrorBoundary>}</SlotHost>
}

function SlotHost({ slot, children }: { slot?: HTMLDivElement | null; children: React.ReactElement }): React.ReactElement {
  // 独立渲染（测试单挂、没有右栏）时落页面流；有挂点就 portal 过去。
  return slot ? createPortal(children, slot) : children
}

/**
 * 政策那一块的说明句与动作：沿用原来那三支判断（哪一格没开 / 源自己关着 / 整块读不到）。
 * 单格没开时动作**落到那一格**，不退化成「打开设置首页」。
 */
export function policyPresentation(input: Readonly<{
  text: Readonly<{ policyPath: PolicyPathCopy }>
  probability: CellReadDecision
  fed: CellReadDecision
  unavailable: boolean
  reloadPolicy: () => void
  onConfigureSources: () => void
  onManageSource: (focus: Readonly<{ business: 'dashboard'; moduleKey: 'policy-path'; cellId: string }>) => void
  resolveKey: (key: string) => string
}>): Readonly<Record<string, unknown>> {
  const notice = policyNoticeOf(input)
  const policyState = input.probability.kind !== 'read' || input.fed.kind !== 'read'
    ? 'disabled' as const
    : input.unavailable ? 'unreadable' as const : undefined
  return {
    ...(policyState === undefined ? {} : { policyState }),
    ...(policyState === 'disabled' ? { onOpenPolicySources: input.onConfigureSources } : {}),
    ...(notice === undefined ? {} : { policyNotice: notice })
  }
}

export function policyNoticeOf(input: Parameters<typeof policyPresentation>[0]):
Readonly<{ sentence: string; actionLabel?: string; onAction?: () => void }> | undefined {
  const { text, probability, fed, resolveKey } = input
  const sourceOff = [probability, fed].find((decision) => decision.kind === 'source-disabled')
  if (sourceOff !== undefined && sourceOff.kind === 'source-disabled') {
    return {
      sentence: text.policyPath.dependencySourceOff.replace('{source}', resolveKey(`settings.intelligenceSources.sourceNames.${sourceOff.sourceId}`)),
      actionLabel: resolveKey('pages.intelligence.portal.data.enableSources'),
      onAction: input.onConfigureSources
    }
  }
  const offCells = [probability, fed].filter((decision) => decision.kind !== 'read')
  if (offCells.length === 2) {
    return {
      sentence: text.policyPath.bothCellsOff,
      actionLabel: resolveKey('pages.intelligence.portal.data.configureSources'),
      onAction: input.onConfigureSources
    }
  }
  if (offCells.length === 1) {
    const cellKey = probability.kind === 'read' ? 'fed' as const : 'probability' as const
    return {
      sentence: cellKey === 'fed' ? text.policyPath.fedCellOff : text.policyPath.probabilityCellOff,
      actionLabel: resolveKey('pages.intelligence.portal.data.enableSources'),
      onAction: () => input.onManageSource({ business: 'dashboard', moduleKey: 'policy-path', cellId: dashboardCellId('policy-path', cellKey) })
    }
  }
  if (input.unavailable) {
    return {
      sentence: resolveKey('pages.intelligence.portal.data.unreadable'),
      actionLabel: resolveKey('pages.intelligence.portal.data.retry'),
      onAction: input.reloadPolicy
    }
  }
  return undefined
}
