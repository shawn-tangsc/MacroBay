import { useCallback, useEffect, useState } from 'react'

import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../shared/i18n/productText'
import { EconomicCalendar, macroEconomicCalendarClient, marketCalendarClient } from '../../features/macro/economic-calendar'
import { intelligenceFearGreedClient } from '../../features/industry/fear-greed'
import { intelligenceFundingRateHistoryClient, intelligenceOpenInterestClient } from '../../features/industry/positioning'
import { collectCapitalConditionsSources, intelligenceCapitalConditionsClient } from '../../features/industry/capital-conditions'
import { AgentPortal } from './AgentPortal'
import { useCryptoActivation } from './useCryptoActivation'
import { marketIntelligenceAgents } from './agentPortalModel'
import { cellEnabledClient } from '../../shared/ipc/cellEnabledClient'
import { CryptoIntelligenceDashboard } from './CryptoIntelligenceDashboard'
import { DailyBriefingPage } from './DailyBriefingPage'
import { DRAWER_MENUS, type ConfigDrawerMenu } from '../../settings/config-drawer/drawerPreviewRows'
import { businessFocusFromRequest, drawerSectionFromRequest, menuFromSettingsDrawer, normalizeConfigDrawerRequest, sourcesDataRequestFor, type OpenConfigDrawerRequest } from './configDrawerRequest'
import type { BusinessFocus } from '../../settings/intelligence-sources/BusinessSettingsView'
import { DailyBriefingGeneratedBanner } from './DailyBriefingGeneratedBanner'
import { openWebSearchSettings } from '../../shared/navigation/productShellNavigation'
import { MarketAnalysisDashboardLayout } from './MarketAnalysisDashboardLayout'
import { SelectedCalendarEventDrawer } from './SelectedCalendarEventDrawer'
import { runSourceNowOnce, testSourceConnectionOnce, writeSourceEnabled } from '../../settings/intelligence-sources/sourceWrites'
import type { SourceFilter } from '../../settings/intelligence-sources/SettingsSourceTree'
import { readMarketCalendarMonth } from './readMarketCalendarMonth'
import { createCalendarCardReactionReader } from './calendarCardReaction'

import { SampleModeProvider, useSampleMode } from './SampleModeProvider'
import { SampleModeBanner, type SampleModeBannerText } from './SampleModeBanner'
import { SampleWatermark } from './SampleWatermark'

import './intelligence.css'
import './sampleMode.css'
import { createCrossAssetObservationClient } from '../../shared/ipc/crossAssetObservationClient'
import { createDashboardFeedStatusClient } from '../../shared/ipc/dashboardFeedStatusClient'
import { createMacroMarketSnapshotClient } from '../../shared/ipc/macroMarketSnapshotClient'
import { createMacroRatesSnapshotClient } from '../../shared/ipc/macroRatesSnapshotClient'
import { marketDivergenceClient } from '../../shared/ipc/marketDivergenceClient'

const crossAssetClient = createCrossAssetObservationClient()
/**
 * 日历卡片那一行「±30 分」反应：跨资产那条已有查询（24h、5 分钟档），以事件 +30 分钟为终点读一次。
 * 组合在这里，因为只有页面同时拥有这两个客户端。
 */
const readCalendarCardReaction = createCalendarCardReactionReader(crossAssetClient.query)
const macroMarketClient = createMacroMarketSnapshotClient()
const macroRatesClient = createMacroRatesSnapshotClient()
const dashboardFeedStatusClient = createDashboardFeedStatusClient()

/**
 * 示例模式的 Provider 必须在页面最外层：横幅、水印、入口和「现在」都从它来，
 * 面板本身不知道自己正在回放——它们只是照常调用既有客户端。
 */
export default function IntelligencePage(): React.ReactElement {
  return (
    <SampleModeProvider>
      <IntelligencePageBody />
    </SampleModeProvider>
  )
}

function IntelligencePageBody(): React.ReactElement {
  const language = useShellLanguage()
  const text = productText[language].pages.intelligence.portal
  const sample = useSampleMode()
  const sampleText = text.sampleMode
  const sampleNow = sample.now
  const { activation, sourceCounts, retry: retryActivation } = useCryptoActivation()
  /**
   * 配置抽屉的「请求打开」：入口在别的视图里（日报页 / 日历 / 门户），抽屉自己住在看板那一层。
   * 所以这里只 bump 一个**递增计数**——布尔表达不了「已经开着又点了一次」，而连点入口很常见。
   */
  const [configDrawerRequest, setConfigDrawerRequest] = useState(0)
  const [configDrawerMenu, setConfigDrawerMenu] = useState<ConfigDrawerMenu>('sources')
  /** 屏内定位（只随请求生效一次；读者自己点别的菜单/源后不再回拽）。 */
  const [configDrawerSourceId, setConfigDrawerSourceId] = useState<string | undefined>(undefined)
  /**
   * 「采集与数据」那屏的屏内定位（业务 / 模块卡 / 格）。
   *
   * 为什么单独一个状态：它描述的是**另一屏**里落到哪一项。原先只有「过滤器」这一个口头，
   * 于是日历/舆情的入口把 `'calendar'` 当筛选传下来，而抽屉那屏根本不看筛选——四个入口全停在
   * 「看板」第一屏。定位归 `focus`，单开一个口，跟 `configDrawerSourceId` 同一条规矩：只随请求生效一次。
   */
  const [configDrawerBusinessFocus, setConfigDrawerBusinessFocus] = useState<BusinessFocus>()
  /** 三屏的屏内分区（`focus.<menu>.section`）：只作初值，跟上面两条同一个规矩。 */
  const [configDrawerSection, setConfigDrawerSection] = useState<Readonly<{ menu: ConfigDrawerMenu; section: string }>>()
  /**
   * 「来源与采集」这一屏挂载时的初值过滤器（只作初值，之后的筛选由那一屏自己管）。
   * 第二步才会由门户/看板传值；现在恒为 `undefined`，所以读者看到的仍是看板默认。
   */
  const [initialSourceFilter, setInitialSourceFilter] = useState<SourceFilter>()
  const openConfigDrawer = (input: ConfigDrawerMenu | OpenConfigDrawerRequest, filter?: SourceFilter): void => {
    const request = normalizeConfigDrawerRequest(input)
    const menu = request.menu
    setConfigDrawerSourceId(menu === 'sources' && request.focus?.menu === 'sources' ? request.focus.sourceId : undefined)
    setConfigDrawerBusinessFocus(businessFocusFromRequest(request))
    setConfigDrawerSection(drawerSectionFromRequest(request))
    setConfigDrawerMenu(menu)
    setInitialSourceFilter(filter)
    setConfigDrawerRequest((value) => value + 1)
    setActiveView('dashboard')
  }

  /**
   * 壳层的「去设置」跳转：`AppShellNavigateDetail.settingsDrawer` 带 `{ productId, menuId }`。
   *
   * 只认自己的产品，且 `menuId` 必须是登记表里的七屏之一——不认识就**什么都不做**
   * （不猜、不落默认屏：那会让读者点了 A 却停在 B）。
   */
  useEffect(() => {
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<{ settingsDrawer?: { productId?: string; menuId?: string } }>).detail
      const menu = menuFromSettingsDrawer(detail?.settingsDrawer)
      if (menu === undefined) return
      openConfigDrawer(menu)
    }
    window.addEventListener('app-shell:navigate', handler)
    return () => window.removeEventListener('app-shell:navigate', handler)
    // 只订阅一次：处理器只调 setState，不读 props/state 快照。
  }, [])
  /**
   * 打开「情报」直接落在看板。
   * 用户 2026-11-06：智能体选择页先留着不删，多智能体方案未定前不改结构，只改默认落点。
   * 用户 2026-11-09：看板页头那颗「返回 Agent」整个去掉——那个说法已经不存在——**选择页仍留着，
   * 但暂时没有入口**。所以 `'portal'` 这一档现在没有任何调用点能落到；它不是死代码，等用户想好
   * 多智能体的入口怎么给，再决定是恢复一个入口还是把这一屏下线。别当成无主代码清掉。
   */
  const [activeView, setActiveView] = useState<'portal' | 'dashboard' | 'calendar' | 'briefing'>('dashboard')
  const sampleAvailable = sample.state.scenarioCount > 0
    && sample.state.unavailableReason !== 'no-scenario'
  const openCryptoPrimary = (): void => {
    setActiveView('dashboard')
  }
  /** 门户/看板「配置来源」：**新抽屉**，预设看板筛选（旧看板抽屉入口一并收口）。 */
  const openCryptoSources = (): void => {
    openConfigDrawer(sourcesDataRequestFor())
  }
  const toggleSample = async (): Promise<void> => {
    if (sample.state.active) {
      try {
        await sample.exit()
      } catch {
        // 退出失败保持示例；开关仍为 on。
      }
      return
    }
    try {
      await sample.enter()
    } catch {
      // 进入失败保持真实模式；开关仍为 off。
    }
  }
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
    <div className="mi-sample-surface">
      {sample.state.active ? <SampleWatermark text={sampleText.watermark} /> : null}
      {/*
        「今日简报已生成」在页面顶部。示例模式回放历史数据、简报不可用；简报页自己就显示生成状态，
        两处都不挂这条提示。
      */}
      {!sample.state.active && activeView === 'dashboard' ? (
        <DailyBriefingGeneratedBanner locale={language} text={text.dailyBriefingGeneratedBanner} />
      ) : null}
      {/* 示例模式横幅只属于看板：门户是入口页，不该挂一条状态条。 */}
      {sample.state.active && activeView === 'dashboard' ? (
        <SampleModeBanner
          busy={sample.busy}
          onConnect={() => { void sample.exit().then(() => openConfigDrawer(sourcesDataRequestFor())) }}
          onExit={() => { void sample.exit() }}
          scenarioNow={sample.state.scenarioNow}
          text={sampleText.banner as SampleModeBannerText}
        />
      ) : null}
      {activeView === 'briefing' ? (
        <DailyBriefingPage
          locale={language}
          text={text.dashboard.dailyBriefing}
          eventTitles={text.analysisWorkspace.readableNames.eventName}
          onBack={() => setActiveView('dashboard')}
          onConfigureSources={() => openConfigDrawer(sourcesDataRequestFor())}
          onConfigureWebSearch={openWebSearchSettings}
          onOpenSettings={() => openConfigDrawer('briefing')}
        />
      ) : activeView === 'calendar' ? (
        <EconomicCalendar
          client={macroEconomicCalendarClient}
          now={sampleNow}
          onBack={() => setActiveView('dashboard')}
          openTarget={calendarTarget}
          text={text.calendar}
          onOpenSettings={() => openConfigDrawer(sourcesDataRequestFor({ business: 'calendar' }))}
        />
      ) : activeView === 'dashboard' ? (
        <MarketAnalysisDashboardLayout
          key={sample.sessionKey}
          onOpenAnalysisSettings={() => openConfigDrawer({ menu: 'analysis' })}
          onOpenSettings={(focus) => openConfigDrawer(sourcesDataRequestFor(focus))}
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
            now={sampleNow}
            onClose={onClose}
            readMarketMonth={readMarketMonth}
            selection={selection}
            text={text.calendar}
          />}
        >
        <CryptoIntelligenceDashboard
          /* 格级启停：与抽屉、设置页**同一个单例**（一份存储），页面构造一次往下传。 */
          cellEnabledIo={{ read: () => cellEnabledClient.read(), readSelection: () => cellEnabledClient.readSelection() }}
          key={sample.sessionKey}
          locale={language}
          briefingEnabled={!sample.state.active}
          onOpenBriefing={() => setActiveView('briefing')}
          client={macroEconomicCalendarClient}
          fearGreedClient={intelligenceFearGreedClient}
          fundingRateClient={intelligenceFundingRateHistoryClient}
          openInterestClient={intelligenceOpenInterestClient}
          divergenceClient={marketDivergenceClient}
          capitalConditionsClient={intelligenceCapitalConditionsClient}
          collectCapitalConditionsSources={collectCapitalConditionsSources}
          crossAssetClient={crossAssetClient}
          macroMarketClient={macroMarketClient}
          macroRatesClient={macroRatesClient}
          dashboardFeedStatusClient={dashboardFeedStatusClient}
          now={sampleNow}
          onConfigureSources={() => openConfigDrawer(sourcesDataRequestFor())}
          onManageSource={(focus) => openConfigDrawer(sourcesDataRequestFor(focus))}
          initialSettingsMenu={configDrawerMenu}
          {...(configDrawerSourceId === undefined ? {} : { initialSourceId: configDrawerSourceId })}
          {...(configDrawerBusinessFocus === undefined ? {} : { initialBusinessPosition: configDrawerBusinessFocus })}
          {...(configDrawerSection === undefined ? {} : { initialDrawerSection: configDrawerSection })}
          initialSourceFilter={initialSourceFilter}
          openSettingsRequest={configDrawerRequest}
          /* 「采集与数据」里点源名/红行：切到「数据源」屏，定位到那个源（滚动/描边/焦点归详情）。 */
          /* 舆情卡右边的入口卡 → 抽屉「内容处理」屏（菜单 7 项不变，同一条 openConfigDrawer 路）。 */
          onOpenProcessingSettings={() => openConfigDrawer({ menu: 'processing' })}
          onOpenCalendar={() => setActiveView('calendar')}
          text={text.dashboard}
        />
        </MarketAnalysisDashboardLayout>
      ) : (
        <AgentPortal
          activation={activation}
          agents={marketIntelligenceAgents}
          onOpenSources={openCryptoSources}
          onPrimary={openCryptoPrimary}
          onRetryActivation={retryActivation}
          onToggleSample={() => { void toggleSample() }}
          sample={{ active: sample.state.active, available: sampleAvailable, busy: sample.busy }}
          sourceCounts={sourceCounts}
          text={text}
        />
      )}
    </div>
  )
}
