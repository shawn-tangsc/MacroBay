import { useCallback, useState } from 'react'

import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../shared/i18n/productText'
import { EconomicCalendar, macroEconomicCalendarClient, marketCalendarClient } from '../../features/macro/economic-calendar'
import { intelligenceFearGreedClient } from '../../features/industry/fear-greed'
import { intelligenceFundingRateHistoryClient } from '../../features/industry/funding-rates'
import { collectCapitalConditionsSources, intelligenceCapitalConditionsClient } from '../../features/industry/capital-conditions'
import { AgentActivationDrawer } from './AgentActivationDrawer'
import { AgentPortal } from './AgentPortal'
import { useAgentActivation } from './useAgentActivation'
import { marketIntelligenceActivationSources, marketIntelligenceAgents } from './agentPortalModel'
import { CryptoIntelligenceDashboard } from './CryptoIntelligenceDashboard'
import { MarketAnalysisDashboardLayout } from './MarketAnalysisDashboardLayout'
import { SelectedCalendarEventDrawer } from './SelectedCalendarEventDrawer'
import { DashboardPanelDrawer } from './DashboardPanelDrawer'
import { readMarketCalendarMonth } from './readMarketCalendarMonth'
import { createCalendarCardReactionReader } from './calendarCardReaction'

import './intelligence.css'
import { createCrossAssetObservationClient } from '../../shared/ipc/crossAssetObservationClient'
import { createDashboardFeedStatusClient } from '../../shared/ipc/dashboardFeedStatusClient'
import { createMacroMarketSnapshotClient } from '../../shared/ipc/macroMarketSnapshotClient'
import { createMacroRatesSnapshotClient } from '../../shared/ipc/macroRatesSnapshotClient'

const crossAssetClient = createCrossAssetObservationClient()
/**
 * 日历卡片那一行「±30 分」反应：跨资产那条已有查询（24h、5 分钟档），以事件 +30 分钟为终点读一次。
 * 组合在这里，因为只有页面同时拥有这两个客户端。
 */
const readCalendarCardReaction = createCalendarCardReactionReader(crossAssetClient.query)
const macroMarketClient = createMacroMarketSnapshotClient()
const macroRatesClient = createMacroRatesSnapshotClient()
const dashboardFeedStatusClient = createDashboardFeedStatusClient()

export default function IntelligencePage(): React.ReactElement {
  const language = useShellLanguage()
  const text = productText[language].pages.intelligence.portal
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { agentView, enableRequired: enableRequiredSources, sourceCounts } = useAgentActivation()
  const [sourceDrawerOpen, setSourceDrawerOpen] = useState(false)
  const [activeView, setActiveView] = useState<'portal' | 'dashboard' | 'calendar'>('portal')
  // The card asks for the calendar page and hands over what to look at; the page consumes it
  // when it renders, so no shell navigation contract had to change.
  const [calendarTarget, setCalendarTarget] = useState<{ month: string; eventKey?: string } | undefined>()
  /**
   * The 0xRouter month, paged, in the reader's language.
   *
   * Built here because the page owns both the locale and the client, and injected into the surfaces
   * that need it — the chart's event lines and the event drawer's fallback. Stable identity on
   * purpose: the chart keys its calendar read off it, and a new function per render would re-read a
   * month of the provider's calendar on every render.
   */
  const readMarketMonth = useCallback(
    (month: string, asOf: string) => readMarketCalendarMonth(marketCalendarClient, { month, locale: language === 'en-US' ? 'en' : 'zh', asOf }),
    [language]
  )
  /**
   * The same month, narrowed to its events for the chart: the lines need what happened and when, not
   * how the provider's own refresh went. The drawer gets the full read, because its body prints both.
   */
  const readMarketEvents = useCallback(
    async (month: string, asOf: string) => (await readMarketMonth(month, asOf))?.events ?? null,
    [readMarketMonth]
  )

  return (
    <>
      {activeView === 'calendar' ? (
        <EconomicCalendar
          client={macroEconomicCalendarClient}
          now={() => new Date()}
          onBack={() => setActiveView('dashboard')}
          openTarget={calendarTarget}
          text={text.calendar}
        />
      ) : activeView === 'dashboard' ? (
        <MarketAnalysisDashboardLayout
          onOpenCalendar={(month, eventKey) => { setCalendarTarget({ month, ...(eventKey ? { eventKey } : {}) }); setActiveView('calendar') }}
          text={text}
          locale={language}
          // The one event-title list the product keeps, read here because the page entry owns the
          // locale: the cross-asset panel names its lines with it instead of growing a second copy.
          calendarEventTitles={text.analysisWorkspace.readableNames.eventName}
          // The chart's event lines read both calendar routes; the provider's is injected here.
          readMarketEvents={readMarketEvents}
          // 卡片上一行「±30 分」反应（原型 ④）：读法在 `calendarCardReaction.ts` 里，页面只给客户端。
          readCalendarReaction={readCalendarCardReaction}
          // The calendar's own detail surface, injected: the cross-asset feature never learns the
          // calendar's text contract, and clicking a line here opens exactly what the calendar opens.
          renderEventDetailDrawer={(selection, onClose) => <SelectedCalendarEventDrawer
            client={macroEconomicCalendarClient}
            key={selection.eventKey}
            now={() => new Date()}
            onClose={onClose}
            readMarketMonth={readMarketMonth}
            selection={selection}
            text={text.calendar}
          />}
        >
        <CryptoIntelligenceDashboard
          calendarText={text.calendar}
          client={macroEconomicCalendarClient}
          fearGreedClient={intelligenceFearGreedClient}
          fundingRateClient={intelligenceFundingRateHistoryClient}
          capitalConditionsClient={intelligenceCapitalConditionsClient}
          collectCapitalConditionsSources={collectCapitalConditionsSources}
          crossAssetClient={crossAssetClient}
          macroMarketClient={macroMarketClient}
          macroRatesClient={macroRatesClient}
          dashboardFeedStatusClient={dashboardFeedStatusClient}
          now={() => new Date()}
          onBack={() => {
            setDrawerOpen(false)
            setSourceDrawerOpen(false)
            setActiveView('portal')
          }}
          onConfigureSources={() => setSourceDrawerOpen(true)}
          onManageSource={() => setSourceDrawerOpen(true)}
          onOpenCalendar={() => setActiveView('calendar')}
          text={text.dashboard}
        />
        </MarketAnalysisDashboardLayout>
      ) : <AgentPortal agents={marketIntelligenceAgents} sourceCounts={sourceCounts} onOpenCryptoDashboard={() => setActiveView('dashboard')} text={text} />}
      {sourceDrawerOpen ? <DashboardPanelDrawer
        onClose={() => setSourceDrawerOpen(false)}
        open
      /> : null}
      <AgentActivationDrawer
        groups={agentView?.groups}
        onClose={() => setDrawerOpen(false)}
        onEnableRequired={enableRequiredSources}
        open={drawerOpen}
        sources={marketIntelligenceActivationSources}
        text={text.drawer}
      />
    </>
  )
}
