import { Button } from 'antd'
import { ArrowLeft, ChevronRight, RefreshCw, Settings2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'
import { LoadingSpinner, LoadingState } from '@platform/ui/components/loading'
import { StatusPill } from '@platform/ui/components/status-pill'
import { Tabs } from '@platform/ui/components/tabs'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'
import { toReadableConclusionText } from '../../../contracts/marketAnalysisReadableText'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import type { MarketAnalysisTimelineEntry } from '../../shared/ipc/marketAnalysisTimelineClient'
import { analysisTimelinePaging, analysisTimelinePagingPolicy } from './analysisTimelinePaging'
import { groupCaptionFor, timelineSpansGroups } from './analysisTimelineGrouping'
import { conclusionReadableNames } from './analysisConclusionVocabulary'
import { conclusionSummaryText, conclusionWithoutDirection, readConclusionDirection } from './analysisConclusionBlocks'
import { analysisConclusionDirectionPolicy, localizedDirectionTerm } from './analysisConclusionDirectionPolicy'
import { oneOffTriggerReasons } from './analysisTriggerStatusPresentation'
import { ANALYSIS_STATUS_KEY, ANALYSIS_STATUS_TONE } from './analysisStatusPresentation'
import type { AnalysisTimelineText, UseMarketAnalysisTimelineResult } from './useMarketAnalysisTimeline'
import { useMarketAnalysisSettings, type MarketAnalysisSettingsRefusal } from './useMarketAnalysisSettings'
import { AnalysisRequestErrorBanner, useDismissibleError } from './AnalysisRequestErrorBanner'
import { MarketAnalysisSettingsDialog } from './MarketAnalysisSettingsDialog'


export type MarketAnalysisTimelineText = AnalysisTimelineText & Readonly<{
  /** The calm status shown when a refresh had nothing to do because an analysis already exists. */
  analysisRefreshAlreadyAvailable: string
  workspaceLabel: string
  title: string
  back: string
  empty: string
  /** Optional so partial text objects used outside the full i18n bundle still type-check. */
  readTrace?: string
  /** 列表区不再有可见标题（用户 2026-11-18）；这个键只留作可访问名以外的历史字段。 */
  timeline: string
  /** 两个页签：成功（有正文的行）与失败（没有正文的行）。 */
  tabSuccess: string
  tabFailed: string
  /** tablist 的可访问名。 */
  tabsAria: string
  requestInitialAnalysis: string
  refreshAnalysis: string
  initialAnalysisQueued: string
  initialAnalysisUnavailable: string
  analysisRefreshFailed: string
  /** The bounded wait ended while the run was still queued/running. */
  analysisStillRunning: string
  analysisServiceNotReady: string
  /** 请求被拒是因为没有可用的模型：一次冻结都没排，读者要去看模型设置。 */
  analysisProviderNotReady: string
  /** 请求被拒是因为引不出可核对的证据（原始记录可能已不在保留期）：换最新一条，不是重试。 */
  analysisInsufficientEvidence: string
  retryAnalysis: string
  /** Label of the control that puts an error banner away. */
  dismissError: string
  /** Settings surface: the switch, the model, and the reasons a save was refused. */
  settings: string
  settingsTitle: string
  analysisEnabled: string
  analysisEnabledHint: string
  analysisModel: string
  modelFollowDefault: string
  /** Prefix for "this is the platform's default assistant model, not an explicit pick". */
  followsDefaultPrefix: string
  enableAnalysis: string
  analysisOffHint: string
  refusalModelUnconfigured: string
  refusalModelUnavailable: string
  refusalFailed: string
  saving: string
  save: string
  cancel: string
  summaryVersion: string
  evidenceCount: string
  analysisRun: string
  loadMore: string
  triggerStatus: { label: string; since: string; slotOpen: string; slotDelayed: string; reasons: Record<string, string> }
  /**
   * Names for the event kinds. Optional so a partial text object (a test, an older bundle) still
   * renders: the caption then falls back to the event's own subject.
   */
  groupTypes?: Record<string, string>
  /** 新闻分组那行标题的解释位：`背景新闻：{title}`。与「最近一次判定」分开，不拼成一行。 */
  groupBackground: string
}>

type Props = Readonly<{
  text: MarketAnalysisTimelineText
  timeline: UseMarketAnalysisTimelineResult
  onBack?: () => void
  onSelect?: (entry: MarketAnalysisTimelineEntry) => void
  /**
   * 由宿主提供「打开 AI 分析设置」的入口。给了它，这一屏就不再自己挂一个设置对话框：
   * 同一个设置面两个草稿，保存的先后会互相覆盖，读者也无从知道自己在改哪一份。
   */
  onOpenSettings?: () => void
}>



/**
 * Timeline list surface. It renders only the list and the request controls; the
 * node detail is surfaced by the main-area drawer so the same conclusion is not
 * rendered in two places. Data and selection state come from the shared
 * workspace hook.
 */
export function MarketAnalysisTimeline({ onBack, text, timeline, onSelect, onOpenSettings }: Props): React.ReactElement {
  const { state, attempt, requestState } = timeline
  // `loading` is only the short request leg; the run itself stays `queued` while it works, so the
  // button's own icon must spin for both states instead of freezing next to a disabled label.
  //
  // 「正在解析」**不能只看本窗口发起的请求**：自动跑起来、或别处触发的运行，`requestState` 是 `idle`，
  // 按钮就会亮着、点下去被服务端单飞拦——读者体感是「能点但没用」。所以禁用读**时间轴条目**里有没有
  // `running`，和那一行用同一个派生值（一处事实一处定义，两处一分叉就又会「能点但没反应」）。
  const runInFlight = state.entries.some((entry) => entry.status === 'running')
  const analysisInFlight = requestState === 'loading' || requestState === 'queued' || runInFlight
  const formatTime = useShellTimeFormat()
  const resolveProductText = useProductTextKey()
  // An attempt that ended without publishing, kept so an empty list can say why it is empty.
  const failedAttempt = attempt && !['queued', 'running', 'succeeded'].includes(attempt.status) ? attempt : undefined
  // Three failures can be on screen, and each is put away on its own: the request the reader just
  // made, the request that could not start, and the persisted attempt behind an empty list.
  const refreshError = useDismissibleError(requestState === 'failed' && state.entries.length > 0)
  const initialError = useDismissibleError(requestState === 'failed' && state.entries.length === 0)
  const attemptError = useDismissibleError(Boolean(failedAttempt) && requestState !== 'loading' && requestState !== 'queued'
    && !state.loading && !state.failed && state.entries.length === 0)
  // While a run is in flight the action is unavailable, so its label stays the request it was:
  // it used to become the whole queued sentence, which duplicated the status line below it and
  // re-widened the button on every request.
  const actionLabel = attempt && !['queued', 'running'].includes(attempt.status) ? text.retryAnalysis : text.requestInitialAnalysis
  const language = useShellLanguage()
  // Only a list that mixes events needs the caption: scoped to one event, it would repeat the same
  // line on every row. The page is read across groups, so this is usually on.
  const spansGroups = timelineSpansGroups(state.entries)
  const groupTypes = text.groupTypes ?? {}
  const settingsState = useMarketAnalysisSettings()
  // `undefined` means "not read yet". Only an explicit `false` draws the mask: a read that failed
  // must not cover a panel whose capability is in fact enabled.
  const analysisEnabled = settingsState.settings?.enabled
  const masked = analysisEnabled === false
  const [settingsOpen, setSettingsOpen] = useState(false)
  const refusalText = (refusal: MarketAnalysisSettingsRefusal | undefined): string | undefined =>
    refusal === 'model-unconfigured' ? text.refusalModelUnconfigured
      : refusal === 'model-unavailable' ? text.refusalModelUnavailable
        : refusal === 'failed' ? text.refusalFailed
          : undefined
  // Eight nodes at a time, and reaching the end of what is shown is what brings the next eight in —
  // instantly while the workspace still holds read nodes, and by reading on once it does not.
  const [pagesSuccess, setPagesSuccess] = useState(1)
  const [pagesFailed, setPagesFailed] = useState(1)
  const [tab, setTab] = useState<'success' | 'failed'>('success')
  // 成功页 = 有正文的行（已发布 / 过期 / 已替代）＋「正在解析」。时间轴首屏仍会按旧规则补进
  // 最多 20 条 failed 行——那是旧行为，**失败页不再用它们**（否则与新读口重复），所以这里滤掉。
  const successEntries = state.entries.filter((entry) => entry.status !== 'failed')
  // 失败页 = 「所有失败」，来自按运行分页的独立读口（`listFailedRuns`），与上面那条读各走各的游标。
  const failedEntries = timeline.failedRuns.entries
  // 两个页签各自算「已经翻到几条」：一边翻到 40 条不会把另一边也撑开，切回来也不退回首页。
  const shownSuccess = analysisTimelinePaging(successEntries.length, pagesSuccess)
  const shownFailed = analysisTimelinePaging(failedEntries.length, pagesFailed)
  const shown = tab === 'failed' ? shownFailed : shownSuccess
  const canPull = tab === 'failed'
    ? shownFailed.hasUnread || Boolean(timeline.failedRuns.nextCursor)
    : shownSuccess.hasUnread || Boolean(state.nextCursor)
  const revealMore = (): void => {
    if (tab === 'failed') {
      setPagesFailed(current => current + 1)
      if (!shownFailed.hasUnread) timeline.loadMoreFailedRuns()
      return
    }
    setPagesSuccess(current => current + 1)
    if (!shownSuccess.hasUnread) timeline.loadMore()
  }
  // 第一次打开失败页才去读（不给每次挂载都多一次 IPC）；读失败过则再点一次就是重试。
  useEffect(() => {
    if (tab === 'failed') timeline.ensureFailedRuns()
  }, [tab])
  // The pull is a scroll, not a click: the sentinel at the end of the list is watched, and reading
  // the latest state through a ref keeps one observer alive across the pulls it triggers.
  const pullTarget = useRef<HTMLDivElement>(null)
  const revealMoreRef = useRef(revealMore)
  revealMoreRef.current = revealMore
  useEffect(() => {
    const target = pullTarget.current
    // The button below is the same action for a keyboard: without an observer (or without a sentinel)
    // nothing is lost, it is simply pressed instead of reached.
    if (!target || typeof IntersectionObserver !== 'function') return undefined
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) revealMoreRef.current()
    }, { rootMargin: `0px 0px ${analysisTimelinePagingPolicy.loadAheadPx}px 0px` })
    observer.observe(target)
    return () => observer.disconnect()
  }, [canPull])

  /** 一行时间轴节点：两个页签共用这一份，行为与样式一字不改。 */
  const renderEntry = (entry: MarketAnalysisTimelineEntry): React.ReactElement => {
  const direction = entry.direction ?? readConclusionDirection(entry.safeExcerpt ?? '')
  /**
   * 新闻分组的标题是**背景**，不是触发（用户 2026-11-21）：类型单独一行，标题另起一行写
   * 「背景新闻：…」。以前两者拼成「消息面 · 标题」，读者会把标题读成这次分析的原因，
   * 而真正的触发在下面那行「最近一次判定」。其它分组类型照旧（`宏观 · CPI` 那种是它的名字）。
   */
  const sentimentGroup = spansGroups && entry.groupType === 'sentiment'
  const sentimentLabel = sentimentGroup ? groupTypes.sentiment : undefined
  const backgroundNews = sentimentGroup && entry.groupSubject ? entry.groupSubject : null
  const groupCaption = spansGroups && !sentimentGroup ? groupCaptionFor(entry, groupTypes) : null
  // 一次运行一行：`runKey` 在「正在解析 → 已发布 / 失败」之间不变，所以 React 复用的是同一行，
  // 不是删一行加一行。老主进程没有 `runKey` 时按 `analysisRunId ?? id` 退（依赖一次运行产一行）。
  const rowKey = entry.runKey ?? entry.analysisRunId ?? entry.id
  // `running` / `failed` 没有摘要、没有 `summaryRef`，点开只会是空白：渲染成**不可点**的行，
  // 不出 chevron、不触发选中。宁可它只是「能看见」，也不要「点得进去却是空」。
  const selectable = entry.status !== 'running' && entry.status !== 'failed'
  // `failed` 行给一句人话原因；未知码不印码，药丸本身已经说了「解析失败」。
  const failureDetail = entry.status === 'failed' && entry.failureCode ? text.failureReasons[entry.failureCode] : undefined
  const selected = state.selected?.id === entry.id
  const content = <>
      <span><time>{formatTime(entry.occurredAt, 'second')}</time><StatusPill labelKey={ANALYSIS_STATUS_KEY[entry.status]} resolveText={resolveProductText} tone={ANALYSIS_STATUS_TONE[entry.status]} /></span>
      {/* Which event this row is about. Two conclusions published seconds apart are two
          different events; without the name they read as one conclusion posted twice. */}
      {sentimentLabel ? <small className="mi-analysis-timeline__group-type" data-group-type={entry.groupType}>{sentimentLabel}</small> : null}
      {backgroundNews ? <small className="mi-analysis-timeline__group-background" data-group-background={backgroundNews}>{text.groupBackground.replace('{title}', backgroundNews)}</small> : null}
      {groupCaption ? <small className="mi-analysis-timeline__group">{groupCaption}</small> : null}
      {failureDetail ? <small className="mi-analysis-timeline__failure">{failureDetail}</small> : null}
      {/* The tag and the conclusion share one line, so they live in one flex item: a row is a
          column flex container, and siblings there would stack whatever their display is. */}
      {direction || entry.safeExcerpt ? <span className="mi-analysis-timeline__headline">
        {direction ? <span className="mi-analysis-timeline__direction" data-direction={direction}>
          {localizedDirectionTerm(direction, language)}
        </span> : null}
        {entry.safeExcerpt ? <span className="mi-analysis-timeline__conclusion-line">{toReadableConclusionText(conclusionWithoutDirection(entry.safeExcerpt), conclusionReadableNames, language)}</span> : null}
      </span> : null}
      {selectable ? <ChevronRight className="mi-analysis-timeline__chevron" size={14} aria-hidden="true" /> : null}
      {entry.triggerStatus ? <small className="mi-analysis-timeline__trigger-status" data-trigger-status={entry.triggerStatus.reasonCode}>
        {/* "since" fits a condition the gate keeps re-observing; a reader's own click is a
            one-off moment, so it reads as a time instead. The token list is the service
            policy's, mirrored here rather than imported: that module pulls in test-only
            imports through its policy chain. */}
        {text.triggerStatus.label}：{text.triggerStatus.reasons[entry.triggerStatus.reasonCode]}
        {entry.triggerStatus.slotOpenAt
          // Which open it served, and whether it was late: a 16:00 open analysed at 01:21 the
          // next morning looked like a mistake until the line said so.
          ? `（${text.triggerStatus.slotOpen}${formatTime(entry.triggerStatus.slotOpenAt, 'minute')}${entry.triggerStatus.slotDelayed ? `，${text.triggerStatus.slotDelayed}` : ''}）`
          : ''}
        （{formatTime(entry.triggerStatus.decidedAt, 'second')}{oneOffTriggerReasons.has(entry.triggerStatus.reasonCode) ? '' : ` ${text.triggerStatus.since}`}）
      </small> : null}
  </>
  // A row, not a button: the whole line is one action (select and open this conclusion), and
  // it is registered as a clickable row in the exception list. Selection is announced with
  // `aria-current`, never by background colour alone, and the chevron shows the row is openable.
  return selectable
    ? <button className={`mi-analysis-timeline__entry${selected ? ' is-selected' : ''}`} key={rowKey} onClick={() => onSelect ? onSelect(entry) : void timeline.select(entry)} type="button" aria-current={selected ? 'true' : undefined}>{content}</button>
    : <div className="mi-analysis-timeline__entry mi-analysis-timeline__entry--static" key={rowKey} data-entry-status={entry.status}>{content}</div>
  }

  return (
    <section className="mi-analysis-timeline" aria-label={text.title} data-analysis-enabled={analysisEnabled === undefined ? 'unknown' : String(analysisEnabled)}>
      <header className="mi-analysis-timeline__header" aria-hidden={masked || undefined}>
        <div><p>{text.workspaceLabel}</p><h1>{text.title}</h1></div>
        <div>
          <Button className="mi-analysis-timeline__settings" onClick={() => (onOpenSettings === undefined ? setSettingsOpen(true) : onOpenSettings())} icon={<Settings2 aria-hidden="true" size={14} />}>{text.settings}</Button>
          {onBack ? <Button className="mi-analysis-timeline__back" onClick={onBack} icon={<ArrowLeft aria-hidden="true" size={15} />}>{text.back}</Button> : null}
          {/* The one analysis action sits at the far right, where a separate refresh button used to
              be: the list refreshes itself (live poll, focus), so a second control that only re-read
              it was an action that could not change anything a reader cares about. */}
          {/* 页头这一下重跑的是**最新那条所属的组**。2026-11-20 去掉了「消息面组不给」那层：
              手动入口现在永远走市场线（`requestInitialMarketAnalysis` 不再分流去新闻解读），
              点它产出的就是市场分析，藏掉反而是把一个已经安全的入口藏起来。 */}
          {state.entries.length > 0 ? <div className="mi-analysis-timeline__reanalyse">
            <Button aria-busy={analysisInFlight || undefined}
              disabled={analysisInFlight} onClick={() => void timeline.requestRefreshAnalysis()}
              icon={analysisInFlight ? <LoadingSpinner size="sm" /> : <RefreshCw aria-hidden="true" size={14} />}>{text.refreshAnalysis}</Button>
          </div> : null}
        </div>
      </header>
      <div className="mi-analysis-timeline__workspace-wrap">
      <div className="mi-analysis-timeline__workspace" aria-hidden={masked || undefined}>
        {/* 列表区不再有可见标题（用户 2026-11-18：那一行不要了，内容上移）。可访问名交给 Tabs 那组
            页签，标题字样因此不再出现在 DOM 里。 */}
        {/* 列表区不再有可见标题（用户 2026-11-18：那一行不要了，内容上移）；可访问名留在 aside 上。 */}
        <aside className="mi-analysis-timeline__list" aria-label={text.timeline}>
          {state.loading ? <LoadingState label={text.loading} minHeight={160} /> : null}
          {/* 读失败要能重试：一句「暂不可用」既没出口也不说明「不是没有」，读者只能猜。
              句子复用产品既有那句「这项数据暂时读不到，不是你没有」（与结论卡、抽屉同一口径）。 */}
          {state.failed ? <StateView
            action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: () => void timeline.load() }}
            productReason={{
              key: 'mi.analysisTimeline.listUnreadable',
              resolve: (key, _params) => key === 'mi.analysisTimeline.listUnreadable'
                ? resolveProductText('pages.intelligence.portal.data.drawerUnavailable')
                : ''
            }}
            reasonCode="unreadable"
            size="md"
            state="error"
          /> : null}
          {state.lastRead && text.readTrace ? <p className="mi-analysis-timeline__state" data-timeline-read={state.lastRead}>{text.readTrace}：{state.lastRead}</p> : null}
          {state.entries.length > 0 && requestState === 'already-available' ? <p role="status" className="mi-analysis-timeline__state">{text.analysisRefreshAlreadyAvailable}</p> : null}
          {state.entries.length > 0 && requestState === 'not-ready' ? <p role="status" className="mi-analysis-timeline__state">{text.analysisServiceNotReady}</p> : null}
          {/* 没有模型时一屏可能一条记录都没有：这句不能挂在「已有记录」的条件上，否则读者点了没反应。 */}
          {requestState === 'provider-not-ready' ? <p role="status" className="mi-analysis-timeline__state">{text.analysisProviderNotReady}</p> : null}
          {requestState === 'insufficient-evidence' ? <p role="status" className="mi-analysis-timeline__state">{text.analysisInsufficientEvidence}</p> : null}
          {state.entries.length > 0 && requestState === 'still-running' ? <p role="status" className="mi-analysis-timeline__state">{text.analysisStillRunning}</p> : null}
          {refreshError.visible ? <AnalysisRequestErrorBanner
            // A run that finished without publishing is not a request that failed: the click was
            // accepted, the analysis was rejected. Saying "the request did not go through" for
            // both made a rejected model answer look like a dead button.
            message={timeline.requestFailure === 'run' ? text.attemptFailed : text.analysisRefreshFailed}
            // Only a run failure has a reason. A refused click must not inherit the previous
            // attempt's reason, which would attribute an old run's defect to this request.
            detail={timeline.requestFailure === 'run' && attempt?.failureCode ? text.failureReasons[attempt.failureCode] : undefined}
            dismissLabelKey="pages.intelligence.portal.analysisTimeline.dismissError"
            onDismiss={refreshError.dismiss}
          /> : null}
          {/* 整份列表一条都没有：保持原来的「首次分析」块，不摆两个空页签再在底下放一次按钮。 */}
          {!state.loading && !state.failed && state.entries.length === 0 ? <>
            {/* 整份列表为空时仍用产品那句（页签不出现，也不摆两个空态）。 */}
            <p className="mi-analysis-timeline__state">{text.empty}</p>
            {failedAttempt && attemptError.visible ? <AnalysisRequestErrorBanner
              message={text.attemptFailed}
              detail={text.failureReasons[failedAttempt.failureCode ?? ''] ?? text.initialAnalysisFailed}
              meta={[`${text.analysisRun}：${failedAttempt.id}`, `${text.evidenceCount}：${failedAttempt.evidenceCount}`]}
              dismissLabelKey="pages.intelligence.portal.analysisTimeline.dismissError"
              onDismiss={attemptError.dismiss}
            /> : null}
            {/* The label stays a label; the queued sentence below is the only place it is said.
                **这一颗不按组类别门控，不是漏了**：它只在这一分支出现，而这里 `state.entries` 为空，
                拿不到任何组；同时 `getLatestAttempt` 在主进程只返回**市场线**的运行
                （`marketAnalysisIpc.ts`，`analysisKind: 'market'`），消息面的运行永远不会成为这里的
                「重新分析」。所以它不构成「点了没反应」的入口。 */}
            <Button loading={requestState === 'loading'} disabled={requestState === 'loading' || requestState === 'queued'} onClick={() => void timeline.requestInitialAnalysis()}>{actionLabel}</Button>
            {requestState === 'queued' ? <p role="status" className="mi-analysis-timeline__state">{text.initialAnalysisQueued}</p> : null}
            {requestState === 'unavailable' ? <p role="alert" className="mi-analysis-timeline__state">{text.initialAnalysisUnavailable}</p> : null}
            {initialError.visible ? <AnalysisRequestErrorBanner
              message={text.initialAnalysisFailed}
              dismissLabelKey="pages.intelligence.portal.analysisTimeline.dismissError"
              onDismiss={initialError.dismiss}
            /> : null}
          </> : null}
          {/* 两个页签：成功＝有正文的行，失败＝没有正文的行。两块面板都真渲染（Tabs 全部挂载、
              非活动的加 hidden），行渲染共用 `renderEntry`，分页与「加载更多」两边都在。 */}
          {state.entries.length > 0 ? <Tabs
            items={[
              { value: 'success', labelKey: 'pages.intelligence.portal.analysisTimeline.tabSuccess' },
              { value: 'failed', labelKey: 'pages.intelligence.portal.analysisTimeline.tabFailed' }
            ]}
            value={tab}
            onChange={(next) => setTab(next === 'failed' ? 'failed' : 'success')}
            ariaLabelKey="pages.intelligence.portal.analysisTimeline.tabsAria"
            resolveText={resolveProductText}
            panels={{
              success: successEntries.length === 0
                ? <StateView reasonCode="not-yet" size="md" state="empty" />
                : <>{successEntries.slice(0, shownSuccess.visible).map(renderEntry)}</>,
              failed: timeline.failedRuns.loading && failedEntries.length === 0
                ? <LoadingState label={text.loading} minHeight={160} />
                : timeline.failedRuns.failed === true && failedEntries.length === 0
                  // 读失败不是「没有失败」：给错误面与重试，别画成空。
                  ? <StateView
                    action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: () => timeline.ensureFailedRuns() }}
                    productReason={{
                      key: 'mi.analysisTimeline.failedRunsUnreadable',
                      resolve: (key, _params) => key === 'mi.analysisTimeline.failedRunsUnreadable'
                        ? resolveProductText('pages.intelligence.portal.data.drawerUnavailable')
                        : ''
                    }}
                    reasonCode="unreadable"
                    size="md"
                    state="error"
                  />
                  : failedEntries.length === 0
                    ? <StateView reasonCode="not-yet" size="md" state="empty" />
                    : <>{failedEntries.slice(0, shownFailed.visible).map(renderEntry)}
                      {timeline.failedRuns.loading ? <p role="status" className="mi-analysis-timeline__state">{text.loading}</p> : null}</>
            }}
          /> : null}
          {canPull ? <div className="mi-analysis-timeline__pull" ref={pullTarget}>
            {/* Kept as a real control beside the scroll: a keyboard or screen-reader reader cannot
                perform a pull, and it is also what the sentinel above is measured against. */}
            <Button disabled={state.loading} onClick={revealMore}>{text.loadMore}</Button>
          </div> : null}
        </aside>
      </div>
      </div>
      {/* The mask covers the whole module, the title row included: with the capability off there is
          nothing in the header to act on, and the one action on the mask opens the same dialog the
          header's settings button would. */}
      {masked ? <div className="mi-analysis-timeline__mask" role="region" aria-label={text.analysisOffHint}>
        <div className="mi-analysis-timeline__mask-body">
          <p>{text.analysisOffHint}</p>
          <div>
            <Button type="primary" onClick={() => (onOpenSettings === undefined ? setSettingsOpen(true) : onOpenSettings())}>{text.enableAnalysis}</Button>
          </div>
          {refusalText(settingsState.refusal) ? <p role="alert">{refusalText(settingsState.refusal)}</p> : null}
        </div>
      </div> : null}
      {/* 宿主给了入口就不再挂第二个对话框：一份草稿，一处保存。 */}
      {onOpenSettings === undefined ? <MarketAnalysisSettingsDialog
        onClose={() => setSettingsOpen(false)}
        open={settingsOpen}
        text={text}
      /> : null}
    </section>
  )
}


