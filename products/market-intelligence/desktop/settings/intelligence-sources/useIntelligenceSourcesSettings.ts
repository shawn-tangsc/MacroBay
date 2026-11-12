import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  IntelligenceSourceProfile,
  IntelligenceSourceDefinition
} from '../../../service/intelligence/schema/intelligenceSource'
import type { SafeIntelligenceSourceDetailView } from '../../../service/intelligence/schema/intelligenceSourcesContracts'
import { intelligenceSourcesClient } from '../../shared/ipc/intelligenceSourcesClient'
import { notifySettingsRevision, subscribeSettingsRevision } from '../../shared/events/settingsRevision'
import { createSettingsOrigin, writeSourceEnabled } from './sourceWrites'
import { isSuccessfulCredentialOperation, resolveEnabledNotice, resolveRunNotice, runOutcomeOf, toSaveProfileInput, upsertProfile, waitForRunHealth, withTimeout, type SourceRunOutcome } from './intelligenceSourceProfileEditor'

export { isSuccessfulCredentialOperation }
import type { SettingsView } from '../../../service/intelligence/application/sourceProjection'

type HookState = {
  definitions: IntelligenceSourceDefinition[]
  profiles: IntelligenceSourceProfile[]
  selectedSourceId?: string
  detail?: SafeIntelligenceSourceDetailView
  draftProfile?: IntelligenceSourceProfile
  loading: boolean
  settingsView?: SettingsView
  saving: boolean
  running: boolean
  testingCredentials: boolean
  replaying: boolean
  errorCode: string | null
  /**
   * 写失败的人话（按源保存 / 启用开关）。与 `errorCode` 分开：那个还装着读失败、运行失败，
   * 这条只解释「你刚改的那一下没存上」，并且带一个能重跑那次写的重试。
   */
  saveFailure: string | null
  notice: string | null
  /** 另一处保存了这一域的设置，而本页有未保存的草稿：只提示，不覆盖。 */
  otherSideChanged: boolean
}

export function useIntelligenceSourcesSettings(labels: {
  loadFailed: string
  saveFailed: string
  saved: string
  disabledSaved: string
  enabledManualHint: string
  enabledAutoCollectQueued: string
  runFailed: string
  runQueued: string
  runSucceeded: string
  testFailed: string
  replayFailed: string
  focusGroups: Record<'globalMacro' | 'digitalAssets' | 'aggregateProviders' | 'multiMarketDynamic' | 'plannedMarkets' | 'pending', string>
}) {
  const [state, setState] = useState<HookState>({
    definitions: [],
    profiles: [],
    loading: true,
    saving: false,
    running: false,
    testingCredentials: false,
    replaying: false,
    errorCode: null,
    saveFailure: null,
    notice: null,
    otherSideChanged: false
  })
  const saveQueueRef = useRef(Promise.resolve())
  const pendingSaveCountRef = useRef(0)
  /** 本页写出的变更带着这个 origin 发出去，订阅时忽略自己那一次。 */
  const revisionOriginRef = useRef(createSettingsOrigin('sources'))
  /** 本页有没有未保存的输入（凭据框）。由详情组件回报。 */
  const draftDirtyRef = useRef(false)
  /**
   * 最近一次**没写成功**的保存动作（按源 patch / 启用开关）。
   *
   * 写失败时界面会回滚成旧值——如果不把「这是失败、不是我没点」说出来，读者对着一个弹回的
   * 下拉只能猜（2026-11-13 真机：「选完什么都不发生」）。重试就是**再跑一次那次写**，
   * 不是整页重读：读者改的值还在这次动作里。
   */
  const failedWriteRef = useRef<(() => void) | null>(null)

  const load = useCallback(async (sourceId?: string) => {
    const [pageState, profiles, settingsView] = await Promise.all([
      intelligenceSourcesClient.getPageState(sourceId),
      intelligenceSourcesClient.listProfiles(),
      intelligenceSourcesClient.getSettingsView()
    ])
    failedWriteRef.current = null
    setState((current) => ({
      ...current,
      definitions: pageState.definitions,
      profiles,
      selectedSourceId: pageState.selectedSourceId,
      detail: pageState.detail,
      settingsView,
      draftProfile: pageState.detail?.profile,
      loading: false,
      saving: false,
      errorCode: null,
      saveFailure: null
    }))
  }, [])

  /**
   * The first read and a manual retry are the same action, so the retry button cannot drift from
   * what the page does on mount. `loading` goes back on before the request, which is what keeps the
   * page from drawing an error during a retry.
   */
  const reload = useCallback(() => {
    setState((current) => ({ ...current, loading: true, errorCode: null }))
    void load().catch(() => {
      setState((current) => ({ ...current, loading: false, errorCode: labels.loadFailed }))
    })
  }, [labels.loadFailed, load])

  useEffect(() => {
    reload()
  }, [reload])

  /**
   * C8：另一处保存了「来源」域 → 本页**重读**。
   * 有未保存草稿时**不覆盖**，只立起「另一处已修改」，由读者决定重载还是继续编辑。
   */
  useEffect(() => subscribeSettingsRevision('sources', (detail) => {
    if (detail.origin === revisionOriginRef.current) return
    if (draftDirtyRef.current) {
      setState((current) => ({ ...current, otherSideChanged: true }))
      return
    }
    reload()
  }), [reload])

  const setDraftDirty = useCallback((dirty: boolean) => {
    draftDirtyRef.current = dirty
  }, [])

  /** 「重新载入」：丢掉草稿、按另一处的值重读。 */
  const reloadFromOtherSide = useCallback(() => {
    setState((current) => ({ ...current, otherSideChanged: false }))
    draftDirtyRef.current = false
    reload()
  }, [reload])

  /** 「继续编辑」：只收起提示，草稿原样保留。 */
  const dismissOtherSideChanged = useCallback(() => {
    setState((current) => ({ ...current, otherSideChanged: false }))
  }, [])

  const selectSource = useCallback(async (sourceId: string) => {
    setState((current) => ({ ...current, loading: true, errorCode: null }))
    try {
      await load(sourceId)
    } catch {
      setState((current) => ({ ...current, loading: false, errorCode: labels.loadFailed }))
    }
  }, [labels.loadFailed, load])

  /**
   * 源行/详情的那颗启用开关——**页面上唯一的启用写入点**。
   *
   * 日历源与通用源走不同的服务命令（`setSourceEnabled` 一处路由），写完**重读**：开关的值以
   * 投影为准，不靠组件各自记一份乐观值。失败回滚并把原因留在页面上。
   */
  const toggleSourceEnabled = useCallback(
    async (source: Readonly<{ sourceId: string; kind: string }>, enabled: boolean): Promise<boolean> => {
      const previous = state.profiles.find((profile) => profile.sourceId === source.sourceId)
        ?? (state.draftProfile?.sourceId === source.sourceId ? state.draftProfile : undefined)
      setState((current) => ({
        ...current,
        ...(previous === undefined ? {} : { profiles: upsertProfile(current.profiles, { ...previous, enabled }) }),
        draftProfile: current.draftProfile?.sourceId === source.sourceId
          ? { ...current.draftProfile, enabled }
          : current.draftProfile,
        saving: true,
        errorCode: null
      }))
      try {
        await writeSourceEnabled(source, enabled, revisionOriginRef.current)
        // 写完重读：两个宿主看到的是同一份投影，不是两套乐观值。
        await load(state.selectedSourceId)
        return true
      } catch {
        failedWriteRef.current = () => { void toggleSourceEnabled(source, enabled) }
        setState((current) => ({
          ...current,
          profiles: previous === undefined ? current.profiles : upsertProfile(current.profiles, previous),
          draftProfile: current.draftProfile?.sourceId === source.sourceId && previous !== undefined
            ? previous
            : current.draftProfile,
          saving: false,
          errorCode: labels.saveFailed,
          saveFailure: labels.saveFailed
        }))
        return false
      }
    },
    [labels.saveFailed, load, state.draftProfile, state.profiles, state.selectedSourceId]
  )

  /**
   * 按**源**改采集策略（频率档 / 范围 / 是否纳入舆情）。
   *
   * 与 `updateProfile` 同一套草稿队列与回滚，区别只在基准：那个改「当前选中的草稿」，这个改
   * 页面上任意一行——详情面板里每个源都常显这三行，读者不必先选中它。
   */
  const updateSourceProfile = useCallback(
    (sourceId: string, patch: Partial<IntelligenceSourceProfile>) => {
      /*
        基准**在 setState 之外取**：以前是「在 updater 里顺手记下 previous/next，出来再用」，
        那条路依赖 React 在 `setState` 里同步跑 updater（eager state）——一旦有别的更新在队列里，
        updater 延后执行，`previous` 还是 undefined，函数当场 return：**乐观值画上去了、写一次都没发**。
        读者看到的就是「改了没反应」（2026-11-13 真机复报）。读当前 state 是确定性的。
      */
      const base = state.profiles.find((profile) => profile.sourceId === sourceId)
        ?? (state.draftProfile?.sourceId === sourceId ? state.draftProfile : undefined)
      if (base === undefined) return
      const previous = base
      const next: IntelligenceSourceProfile = { ...base, ...patch }

      setState((current) => ({
        ...current,
        profiles: upsertProfile(current.profiles, next),
        draftProfile: current.draftProfile?.sourceId === sourceId ? next : current.draftProfile,
        saving: true,
        errorCode: null
      }))

      pendingSaveCountRef.current += 1
      saveQueueRef.current = saveQueueRef.current
        .then(async () => {
          const detail = await withTimeout(
            intelligenceSourcesClient.saveProfile(toSaveProfileInput(next)),
            15_000
          )
          failedWriteRef.current = null
          setState((current) => ({
            ...current,
            profiles: upsertProfile(current.profiles, detail.profile),
            errorCode: null,
            saveFailure: null,
            ...(current.selectedSourceId === detail.profile.sourceId
              ? { detail, draftProfile: detail.profile, notice: labels.saved }
              : {})
          }))
          notifySettingsRevision('sources', revisionOriginRef.current)
        })
        .catch(() => {
          failedWriteRef.current = () => updateSourceProfile(sourceId, patch)
          setState((current) => ({
            ...current,
            profiles: upsertProfile(current.profiles, previous),
            draftProfile: current.draftProfile?.sourceId === previous.sourceId ? previous : current.draftProfile,
            errorCode: labels.saveFailed,
            saveFailure: labels.saveFailed
          }))
        })
        .finally(() => {
          pendingSaveCountRef.current = Math.max(0, pendingSaveCountRef.current - 1)
          if (pendingSaveCountRef.current === 0) {
            setState((current) => ({ ...current, saving: false }))
          }
        })
    },
    [labels.saved, labels.saveFailed, state.draftProfile, state.profiles]
  )

  /**
   * 运行一个源（B5）。**按源传参**：设置页的详情里每个源各有一颗按钮，不再只认「选中的那个」。
   * 返回这一次的结果给按钮那一行显示（成功带摘要 / 没成带原因 / 提交了还没结果）。
   */
  const runSourceNow = useCallback(async (sourceId: string): Promise<SourceRunOutcome> => {
    // 「能不能跑」只在 `sourceHealthCells.runNowAnswerOf` 判一次（按钮与四格读同一个答案）；
    // 这里不再自己判一遍 readiness / supportsRunNow——两处判同一件事，迟早一处说能、一处说不能。
    setState((current) => ({ ...current, running: true, errorCode: null, notice: null }))
    try {
      await intelligenceSourcesClient.runNow(sourceId)
      const health = await waitForRunHealth(sourceId)
      const outcome = runOutcomeOf(health, labels)
      setState((current) => ({
        ...current,
        running: false,
        detail: current.detail?.profile.sourceId === sourceId
          ? { ...current.detail, health }
          : current.detail,
        notice: outcome.notice,
        errorCode: outcome.kind === 'failed' ? labels.runFailed : null
      }))
      return outcome
    } catch {
      setState((current) => ({ ...current, running: false, errorCode: labels.runFailed }))
      return { kind: 'failed', notice: labels.runFailed }
    }
  }, [labels])

  /** 旧入口：跑「当前选中的那一个」，行为与改前一致。 */
  const runNow = useCallback(async () => {
    if (!state.selectedSourceId) return
    await runSourceNow(state.selectedSourceId)
  }, [runSourceNow, state.selectedSourceId])

  const testCredentials = useCallback(
    async (credentialDraft?: string) => {
      if (!state.selectedSourceId) return false
      setState((current) => ({ ...current, testingCredentials: true, errorCode: null }))
      try {
        const result = await intelligenceSourcesClient.testCredentials({
          sourceId: state.selectedSourceId,
          credentialDraft
        })
        const succeeded = isSuccessfulCredentialOperation(result, state.selectedSourceId)
        if (!succeeded) {
          setState((current) => ({ ...current, testingCredentials: false }))
          return false
        }
        await load(state.selectedSourceId)
        setState((current) => ({ ...current, testingCredentials: false }))
        return true
      } catch {
        setState((current) => ({ ...current, testingCredentials: false, errorCode: labels.testFailed }))
        return false
      }
    },
    [labels.testFailed, load, state.selectedSourceId]
  )

  const replayWindow = useCallback(async () => {
    if (!state.selectedSourceId) return
    setState((current) => ({ ...current, replaying: true, errorCode: null }))
    try {
      await intelligenceSourcesClient.replayWindow({ sourceId: state.selectedSourceId })
      setState((current) => ({ ...current, replaying: false }))
    } catch {
      setState((current) => ({ ...current, replaying: false, errorCode: labels.replayFailed }))
    }
  }, [labels.replayFailed, state.selectedSourceId])

  const refreshHealth = useCallback(async () => {
    if (!state.selectedSourceId || !state.detail) return
    const health = await intelligenceSourcesClient.getHealth(state.selectedSourceId)
    setState((current) => ({
      ...current,
      detail: current.detail ? { ...current.detail, health } : current.detail
    }))
  }, [state.detail, state.selectedSourceId])

  const needsManualRunPrompt = useMemo(() => {
    if (!state.draftProfile?.enabled || state.draftProfile.collectionPreset !== 'manual') return false
    const health = state.detail?.health
    return !health?.lastSuccessAt
  }, [state.detail?.health, state.draftProfile?.collectionPreset, state.draftProfile?.enabled])

  /**
   * 重试「刚才没写成功的那一次」。没有失败动作（或已经重试过）时什么都不做——
   * 不假装成功，也不再发一次写。
   */
  const retryFailedSave = useCallback(() => {
    const retry = failedWriteRef.current
    failedWriteRef.current = null
    if (retry === null) return
    retry()
  }, [])

  return {
    ...state,
    needsManualRunPrompt,
    reload,
    selectSource,
    toggleSourceEnabled,
    updateSourceProfile,
    retryFailedSave,
    runNow,
    testCredentials,
    replayWindow,
    refreshHealth,
    runSourceNow,
    setDraftDirty,
    reloadFromOtherSide,
    dismissOtherSideChanged,
    /** 本界面实例的域信号 origin：格级写入也用它，别处据此忽略自己那一次。 */
    revisionOrigin: revisionOriginRef.current
  }
}
