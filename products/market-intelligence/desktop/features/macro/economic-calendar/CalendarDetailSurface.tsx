import type { ReactElement } from 'react'

import type { MarketCalendarEvent, MarketCalendarSource } from '../../../../contracts/macro/marketCalendarQueryContracts'
import type { MacroEconomicCalendarClient } from '../../../shared/ipc/macroEconomicCalendarClient'
import { CalendarInspector } from './CalendarInspector'
import { EconomicCalendarEventDetail as EventDetail, EconomicCalendarEventDetailState as EventDetailState, type EconomicCalendarRefreshOperation, type EconomicCalendarRefreshState } from './EconomicCalendarEventDetail'
import type { EconomicCalendarEventView } from './economicCalendarModel'
import type { EconomicCalendarText } from './economicCalendarText'
import { MarketCalendarInspector } from './MarketCalendarEvents'

/** What the detail column can be showing: nothing, a source reading being fetched, or the reading. */
export type CalendarDetailState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'unavailable'; failureCode: keyof EconomicCalendarText['failures'] }
  | { state: 'available'; event: EconomicCalendarEventView }

/**
 * The detail column, and nothing else: which surface a picked row becomes.
 *
 * It is presentational on purpose. The refresh protocol (which source to re-read, with which as-of,
 * and the pending flag) belongs to the page, because a completed refresh moves the month window too;
 * this file only decides what the reader sees for a market event, a loading read, a failed read, or
 * the official event itself, in that order.
 */
export function CalendarDetailSurface({ contentId, when, selectedMarket, selectedLinkedMarket, sourceAdvanced, marketSources, detailState, refreshState, client, text, now, onClose, onRefresh, onReleaseTimeChanged, onRetry, blsUnavailableNotice, blsRefreshBlocked, blsRefreshBlockedCode }: {
  contentId: string | undefined
  when: string | undefined
  selectedMarket: MarketCalendarEvent | undefined
  selectedLinkedMarket: MarketCalendarEvent | undefined
  sourceAdvanced: boolean
  marketSources: readonly MarketCalendarSource[]
  detailState: CalendarDetailState
  refreshState: EconomicCalendarRefreshState | undefined
  client: Pick<MacroEconomicCalendarClient, 'setReleaseTime' | 'clearReleaseTime'>
  text: EconomicCalendarText
  now: () => Date
  onClose: () => void
  onRefresh: (operation: EconomicCalendarRefreshOperation, eventKey: string) => Promise<void>
  onReleaseTimeChanged: () => Promise<void>
  onRetry: () => void
  /** 官方日历已停用时那一句；原样交给详情，置灰与否在那里决定。 */
  blsUnavailableNotice?: string
  /** 置灰的刷新键自己的行内句（为什么不能刷新、何时能好）。与上一句分开：一句是后台现状，一句是这颗键。 */
  blsRefreshBlocked?: string
  /** 行内句旁那颗 ⓘ 里的完整原因码（正文不拼它）。 */
  blsRefreshBlockedCode?: string
}): ReactElement {
  return (
    <CalendarInspector contentId={contentId} onClose={onClose} open={contentId !== undefined} when={when}>
      {selectedMarket && sourceAdvanced ? <p className="mi-economic-calendar__comparison-rule" data-source-advanced>{text.market.sourceAdvanced}</p> : null}
      {selectedMarket ? <MarketCalendarInspector event={selectedMarket} source={marketSources.find(source => source.eventType === selectedMarket.eventType)} text={text} /> : null}
      {selectedLinkedMarket ? <MarketCalendarInspector event={selectedLinkedMarket} source={marketSources.find(source => source.eventType === selectedLinkedMarket.eventType)} text={text} /> : null}
      {!selectedMarket && detailState.state === 'loading' ? <EventDetailState state="loading" text={text.status.loading} /> : null}
      {!selectedMarket && detailState.state === 'available' ? <EventDetail event={detailState.event}
        linkedConsensus={selectedLinkedMarket?.consensus}
        now={now} onRefresh={onRefresh} onReleaseTimeChanged={onReleaseTimeChanged} releaseTimeClient={client} refreshState={refreshState} text={text} blsUnavailableNotice={blsUnavailableNotice} blsRefreshBlocked={blsRefreshBlocked} blsRefreshBlockedCode={blsRefreshBlockedCode} /> : null}
      {!selectedMarket && detailState.state === 'unavailable' ? <EventDetailState state="error"
        text={text.failures[detailState.failureCode]} onRetry={onRetry} /> : null}
    </CalendarInspector>
  )
}
