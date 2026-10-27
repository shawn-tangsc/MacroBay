import { Alert, Button, Switch } from 'antd'
import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { macroCalendarProviderSettingsPolicy, type DashboardSourceConnectionResult, type MacroCalendarProviderPageState, type MacroCalendarSettingsProviderId } from '../../../contracts/macro/economicCalendarQueryContracts'
import { LoadingState } from '@platform/ui/components/loading'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'
import { productText } from '../../shared/i18n/productText'
import { MarketCalendarPanel } from '../../features/macro-calendar/MarketCalendarPanel'
import { useMarketCalendarFeed } from '../../features/macro-calendar/useMarketCalendarFeed'
import { BlsScheduleControls } from '../../features/macro-calendar/BlsScheduleControls'
import { useBlsScheduleSync } from '../../features/macro-calendar/useBlsScheduleSync'
import { listCalendarFeeds } from '../../../service/intelligence/macro-calendar/calendarFeedRegistry'
import { macroCalendarProviderClient } from '../../shared/ipc/macroCalendarProviderClient'

type RunNowFeedback = 'queued' | 'skipped' | 'failed' | 'completed-succeeded' | 'completed-failed'
type ConnectionFeedback = 'succeeded' | 'failed'
type ScheduleState = { mode: 'interval'; intervalSeconds: number; anchor: 'last-complete'; startupCatchUp: true; runNowAvailable: true }
type State = { providers: readonly MacroCalendarProviderPageState[]; loading: boolean; running?: string; runNowFeedback: Partial<Record<MacroCalendarSettingsProviderId, RunNowFeedback>>; error: boolean; schedule?: ScheduleState; connection?: { providerId: MacroCalendarSettingsProviderId; feedback?: ConnectionFeedback; operationId: number } }
type SettingsContext = { active: boolean; providerId?: MacroCalendarSettingsProviderId; sourceDrawerMode: boolean; generation: number }
type OperationKind = 'load' | 'profile' | 'run' | 'connection'
type OperationRefs = Record<OperationKind, number>

const macroCalendarRunNowFeedbackPolicy = {
  alertTypes: { queued: 'info', skipped: 'warning', failed: 'error', 'completed-succeeded': 'success', 'completed-failed': 'error' },
  fallbackFeedback: 'failed'
} as const

const macroCalendarSettingsLifecyclePolicy = {
  globalSettingsActive: true
} as const

function initialState(loading = true): State {
  return { providers: [], loading, runNowFeedback: {}, error: false }
}

export function MacroCalendarSettings({ providerId, sourceDrawerMode = false, active = macroCalendarSettingsLifecyclePolicy.globalSettingsActive }: { providerId?: MacroCalendarSettingsProviderId; sourceDrawerMode?: boolean; active?: boolean }): React.ReactElement {
  const language = useShellLanguage()
  const text = productText[language].settings.macroCalendar
  const [state, setState] = useState<State>(() => initialState())
  const marketCalendarFeeds = listCalendarFeeds().filter((feed) => feed.owner === 'market')
  const marketCalendar = useMarketCalendarFeed(undefined, language === 'zh-CN' ? 'zh' : 'en')
  const bls = useBlsScheduleSync('macro-calendar-bls')
  const mountedRef = useRef(false)
  const contextRef = useRef<SettingsContext>({ active, providerId, sourceDrawerMode, generation: 0 })
  const operationRefs = useRef<OperationRefs>({ load: 0, profile: 0, run: 0, connection: 0 })
  if (!sameSettingsContext(contextRef.current, { active, providerId, sourceDrawerMode })) {
    contextRef.current = { active, providerId, sourceDrawerMode, generation: contextRef.current.generation + 1 }
    invalidateOperations(operationRefs)
  }

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; invalidateOperations(operationRefs) }
  }, [])

  useEffect(() => {
    const context = contextRef.current
    if (!context.active) {
      setState(initialState(false))
      return
    }
    const operationId = nextOperation(operationRefs, 'load')
    setState(initialState())
    void load(context, operationId)
  }, [active, providerId, sourceDrawerMode])

  async function load(context: SettingsContext, operationId: number): Promise<void> {
    try {
      const [result, schedule] = await Promise.all([
        macroCalendarProviderClient.getPageState(),
        context.sourceDrawerMode && context.providerId ? macroCalendarProviderClient.getProviderSchedule(context.providerId) : undefined
      ])
      if (!isCurrentSettingsOperation(mountedRef, contextRef, operationRefs, context, 'load', operationId)) return
      setState((current) => result.state === 'available'
        ? { ...current, providers: result.providers, loading: false, error: false, schedule: safeSchedule(schedule, context.providerId) }
        : { ...current, loading: false, error: true, schedule: undefined })
    } catch {
      if (isCurrentSettingsOperation(mountedRef, contextRef, operationRefs, context, 'load', operationId)) setState((current) => ({ ...current, loading: false, error: true, schedule: undefined }))
    }
  }

  async function setEnabled(provider: MacroCalendarProviderPageState, enabled: boolean): Promise<void> {
    const context = contextRef.current
    const operationId = nextOperation(operationRefs, 'profile')
    if (!isCurrentSettingsOperation(mountedRef, contextRef, operationRefs, context, 'profile', operationId)) return
    try {
      const result = await macroCalendarProviderClient.saveProfile({ providerId: provider.providerId, enabled })
      if (!isCurrentSettingsOperation(mountedRef, contextRef, operationRefs, context, 'profile', operationId)) return
      if (result.state === 'saved') setState((current) => ({ ...current, providers: current.providers.map((item) => item.providerId === provider.providerId ? { ...item, enabled: result.provider.enabled } : item), error: false }))
      else setState((current) => ({ ...current, error: true }))
    } catch {
      if (isCurrentSettingsOperation(mountedRef, contextRef, operationRefs, context, 'profile', operationId)) setState((current) => ({ ...current, error: true }))
    }
  }

  async function runNow(provider: MacroCalendarProviderPageState): Promise<void> {
    const context = contextRef.current
    const operationId = nextOperation(operationRefs, 'run')
    if (!isCurrentSettingsOperation(mountedRef, contextRef, operationRefs, context, 'run', operationId)) return
    setState((current) => ({ ...current, running: provider.providerId, runNowFeedback: withoutRunNowFeedback(current.runNowFeedback, provider.providerId), error: false }))
    let result: unknown
    try {
      result = await macroCalendarProviderClient.runProviderNow(provider.providerId)
    } catch {
      result = undefined
    }
    if (!isCurrentSettingsOperation(mountedRef, contextRef, operationRefs, context, 'run', operationId)) return
    const feedback = runNowFeedback(result, provider.providerId)
    setState((current) => ({ ...current, running: undefined, runNowFeedback: { ...current.runNowFeedback, [provider.providerId]: feedback } }))
    if (feedback !== 'completed-succeeded' && feedback !== 'completed-failed') return
    try {
      const health = await macroCalendarProviderClient.getProviderHealth(provider.providerId)
      if (!isCurrentSettingsOperation(mountedRef, contextRef, operationRefs, context, 'run', operationId)) return
      setState((current) => mergeProviderHealth(current, provider.providerId, health))
    } catch {
      // Completion feedback remains authoritative when the optional health refresh is unavailable.
    }
  }


  async function testProviderConnection(provider: MacroCalendarProviderPageState): Promise<void> {
    const context = contextRef.current
    const operationId = nextOperation(operationRefs, 'connection')
    if (!isCurrentSettingsOperation(mountedRef, contextRef, operationRefs, context, 'connection', operationId)) return
    setState((current) => ({ ...current, connection: { providerId: provider.providerId, operationId } }))
    let result: unknown
    try {
      result = await macroCalendarProviderClient.testProviderConnection(provider.providerId)
    } catch {
      result = { state: 'failed', failureCode: 'response-unavailable' }
    }
    if (!isCurrentSettingsOperation(mountedRef, contextRef, operationRefs, context, 'connection', operationId)) return
    setState((current) => ({ ...current, connection: { providerId: provider.providerId, feedback: isSuccessfulConnection(result) ? 'succeeded' : 'failed', operationId } }))
  }

  return (
    <section className="macro-calendar-settings">
      {providerId === undefined ? <header className="macro-calendar-settings__header"><h2>{text.title}</h2><p>{text.description}</p></header> : null}
      {state.loading ? <LoadingState label={text.loading} minHeight={160} /> : null}
      {state.error ? <p className="macro-calendar-settings__error">{text.unavailable}</p> : null}
      <div className="macro-calendar-settings__cards">
        {state.providers.filter((provider) => providerId === undefined || provider.providerId === providerId).map((provider) => {
          const feedback = state.runNowFeedback[provider.providerId]
          return <article className="macro-calendar-settings__card" key={provider.providerId}>
            <div><h3>{text.providers[provider.providerId]}</h3><p>{text.health[provider.scheduleHealth]}</p></div>
            <Switch aria-label={text.providers[provider.providerId]} checked={provider.enabled} onChange={(enabled) => void setEnabled(provider, enabled)} />
            {providerId === undefined ? <dl><div><dt>{text.failureCount}</dt><dd>{provider.consecutiveFailures}</dd></div>{provider.lastCompletedAt ? <div><dt>{text.lastCompletedAt}</dt><dd>{provider.lastCompletedAt}</dd></div> : null}</dl> : null}
            <Button type="primary" icon={<RefreshCw size={14} />} disabled={!provider.enabled || state.running !== undefined} loading={state.running === provider.providerId} onClick={() => void runNow(provider)}>{text.runNow}</Button>
            {feedback ? <Alert message={text.runNowFeedback[feedback]} type={macroCalendarRunNowFeedbackPolicy.alertTypes[feedback]} /> : null}
            {sourceDrawerMode ? <>
              <Button aria-label={text.testConnection} disabled={state.connection?.providerId === provider.providerId && state.connection.feedback === undefined} loading={state.connection?.providerId === provider.providerId && state.connection.feedback === undefined} onClick={() => void testProviderConnection(provider)}>{state.connection?.providerId === provider.providerId && state.connection.feedback === undefined ? text.testingConnection : text.testConnection}</Button>
              {state.schedule ? <p>{text.schedule.macro.replace('{hours}', String(state.schedule.intervalSeconds / 3600))}</p> : null}
              {state.connection?.providerId === provider.providerId && state.connection.feedback ? <Alert message={text.connection[state.connection.feedback]} type={state.connection.feedback === 'succeeded' ? 'success' : 'error'} /> : null}
            </> : null}
          </article>
        })}
      </div>
      {providerId === undefined ? <section className="macro-calendar-settings__bls">
        <header><h3>{text.blsCard.title}</h3><p>{text.blsCard.description}</p></header>
        <BlsScheduleControls
          feedback={bls.feedback}
          pending={bls.pending}
          selected="macro-calendar-bls"
          text={text.blsSchedule}
          onSync={bls.sync}
        />
      </section> : null}
      {providerId === undefined ? <section className="macro-calendar-settings__pending">
        <header><h3>{text.pendingFeeds.title}</h3><p>{text.pendingFeeds.hint}</p></header>
        <p>{text.pendingFeeds.coinMarketCal}</p>
      </section> : null}
      {providerId === undefined ? <section className="macro-calendar-settings__market">
        <header><h3>{text.marketCalendar.title}</h3><p>{text.marketCalendar.description}</p></header>
        <MarketCalendarPanel
          feeds={marketCalendarFeeds}
          refreshing={marketCalendar.refreshing}
          feedback={marketCalendar.feedback}
          text={text.marketCalendar}
          onRefresh={() => void marketCalendar.refresh()}
        />
      </section> : null}
    </section>
  )
}

function withoutRunNowFeedback(feedback: State['runNowFeedback'], providerId: MacroCalendarSettingsProviderId): State['runNowFeedback'] {
  const next = { ...feedback }
  delete next[providerId]
  return next
}

function runNowFeedback(result: unknown, providerId: MacroCalendarSettingsProviderId): RunNowFeedback {
  try {
    if (!isRunNowResult(result)) return macroCalendarRunNowFeedbackPolicy.fallbackFeedback
    if (result.state === 'queued') return result.providerId === providerId ? 'queued' : macroCalendarRunNowFeedbackPolicy.fallbackFeedback
    if (result.state === 'completed') return result.providerId === providerId ? result.outcome === 'succeeded' ? 'completed-succeeded' : 'completed-failed' : macroCalendarRunNowFeedbackPolicy.fallbackFeedback
    return result.state
  } catch {
    return macroCalendarRunNowFeedbackPolicy.fallbackFeedback
  }
}

function isRunNowResult(value: unknown): value is { state: 'queued'; providerId: MacroCalendarSettingsProviderId } | { state: 'completed'; providerId: MacroCalendarSettingsProviderId; outcome: 'succeeded' | 'failed' } | { state: 'skipped' | 'failed'; failureCode: string } {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length > 0) return false
    const record = value as Record<string, unknown>
    const keys = Object.getOwnPropertyNames(record)
    if (!keys.every((key) => { const descriptor = Object.getOwnPropertyDescriptor(record, key); return Boolean(descriptor && 'value' in descriptor) })) return false
    if (record.state === 'queued') return keys.length === 2 && Object.hasOwn(record, 'providerId') && macroCalendarProviderSettingsPolicy.providerIds.includes(record.providerId as MacroCalendarSettingsProviderId)
    if (record.state === 'completed') return keys.length === 3 && Object.hasOwn(record, 'providerId') && Object.hasOwn(record, 'outcome') && macroCalendarProviderSettingsPolicy.providerIds.includes(record.providerId as MacroCalendarSettingsProviderId) && (record.outcome === 'succeeded' || record.outcome === 'failed')
    if (record.state === 'skipped') return keys.length === 2 && Object.hasOwn(record, 'failureCode') && (record.failureCode === 'provider-disabled' || record.failureCode === 'provider-unavailable')
    return record.state === 'failed' && keys.length === 2 && Object.hasOwn(record, 'failureCode') && record.failureCode === 'provider-settings-unavailable'
  } catch {
    return false
  }
}

function sameSettingsContext(current: SettingsContext, next: Omit<SettingsContext, 'generation'>): boolean {
  return current.active === next.active && current.providerId === next.providerId && current.sourceDrawerMode === next.sourceDrawerMode
}

function invalidateOperations(operations: { current: OperationRefs }): void {
  operations.current = {
    load: operations.current.load + 1,
    profile: operations.current.profile + 1,
    run: operations.current.run + 1,
    connection: operations.current.connection + 1
  }
}

function nextOperation(operations: { current: OperationRefs }, kind: OperationKind): number {
  operations.current[kind] += 1
  return operations.current[kind]
}

function isCurrentSettingsOperation(mounted: { current: boolean }, current: { current: SettingsContext }, operations: { current: OperationRefs }, expected: SettingsContext, kind: OperationKind, operationId: number): boolean {
  return mounted.current && current.current.active && current.current.generation === expected.generation && current.current.providerId === expected.providerId && current.current.sourceDrawerMode === expected.sourceDrawerMode && operations.current[kind] === operationId
}

function mergeProviderHealth(current: State, providerId: MacroCalendarSettingsProviderId, result: unknown): State {
  try {
    if (!result || typeof result !== 'object' || Array.isArray(result) || Object.getPrototypeOf(result) !== Object.prototype || Object.getOwnPropertySymbols(result).length > 0) return current
    const page = result as Record<string, unknown>
    if (Object.getOwnPropertyNames(page).length !== 2 || page.state !== 'available' || !Array.isArray(page.providers)) return current
    const provider = page.providers.find((item) => item && typeof item === 'object' && !Array.isArray(item) && (item as Record<string, unknown>).providerId === providerId) as Record<string, unknown> | undefined
    if (!provider || Object.getOwnPropertySymbols(provider).length > 0) return current
    const providerFields = Object.getOwnPropertyNames(provider)
    const allowedFields = ['providerId', 'enabled', 'scheduleHealth', 'lastCompletedAt', 'consecutiveFailures']
    if (!providerFields.every((field) => allowedFields.includes(field)) || !['providerId', 'enabled', 'scheduleHealth', 'consecutiveFailures'].every((field) => Object.hasOwn(provider, field))) return current
    if (providerFields.some((field) => { const descriptor = Object.getOwnPropertyDescriptor(provider, field); return !descriptor || !('value' in descriptor) })) return current
    if (provider.providerId !== providerId || typeof provider.enabled !== 'boolean' || !macroCalendarProviderSettingsPolicy.scheduleHealthStates.includes(provider.scheduleHealth as never) || !Number.isSafeInteger(provider.consecutiveFailures) || (provider.consecutiveFailures as number) < 0 || (provider.lastCompletedAt !== undefined && (typeof provider.lastCompletedAt !== 'string' || !macroCalendarProviderSettingsPolicy.canonicalUtcMillisPattern.test(provider.lastCompletedAt) || new Date(provider.lastCompletedAt).toISOString() !== provider.lastCompletedAt))) return current
    return {
      ...current,
      providers: current.providers.map((item) => item.providerId === providerId
        ? { ...item, scheduleHealth: provider.scheduleHealth as MacroCalendarProviderPageState['scheduleHealth'], consecutiveFailures: provider.consecutiveFailures as number, ...(typeof provider.lastCompletedAt === 'string' ? { lastCompletedAt: provider.lastCompletedAt } : {}) }
        : item)
    }
  } catch {
    return current
  }
}

function safeSchedule(value: unknown, providerId: MacroCalendarSettingsProviderId | undefined): ScheduleState | undefined {
  try {
    const record = readExactRecord(value, ['state', 'providerId', 'schedule'])
    if (!providerId || !record || record.state !== 'available' || record.providerId !== providerId) return undefined
    const schedule = readExactRecord(record.schedule, ['mode', 'intervalSeconds', 'anchor', 'startupCatchUp', 'runNowAvailable'])
    const intervalSeconds = typeof schedule?.intervalSeconds === 'number' && Number.isSafeInteger(schedule.intervalSeconds) && schedule.intervalSeconds > 0
      ? schedule.intervalSeconds
      : undefined
    if (!schedule || schedule.mode !== 'interval' || intervalSeconds === undefined ||
      schedule.anchor !== 'last-complete' || schedule.startupCatchUp !== true || schedule.runNowAvailable !== true) return undefined
    return { mode: 'interval', intervalSeconds, anchor: 'last-complete', startupCatchUp: true, runNowAvailable: true }
  } catch { return undefined }
}

function readExactRecord(value: unknown, fields: readonly string[]): Record<string, unknown> | undefined {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length > 0) return undefined
    const names = Object.getOwnPropertyNames(value)
    if (names.length !== fields.length || !fields.every((field) => Object.hasOwn(value, field))) return undefined
    for (const field of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, field)
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return undefined
    }
    return value as Record<string, unknown>
  } catch { return undefined }
}

function isSuccessfulConnection(value: unknown): value is Extract<DashboardSourceConnectionResult, { state: 'succeeded' }> {
  try {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype &&
      Object.getOwnPropertyNames(value).length === 1 && Object.getOwnPropertySymbols(value).length === 0 &&
      Object.hasOwn(value, 'state') && Object.getOwnPropertyDescriptor(value, 'state')?.value === 'succeeded')
  } catch { return false }
}
