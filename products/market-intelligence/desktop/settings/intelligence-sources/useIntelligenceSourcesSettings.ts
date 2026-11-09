import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  IntelligenceSourceProfile,
  IntelligenceSourceDefinition
} from '../../../service/intelligence/schema/intelligenceSource'
import type { IntelligenceFocusMarket } from '../../../service/intelligence/schema/intelligenceSource'
import type { SafeIntelligenceSourceDetailView } from '../../../service/intelligence/schema/intelligenceSourcesContracts'
import type { IntelligenceFocusMarketSettings } from '../../../service/intelligence/application/intelligenceFocusSettings'
import { intelligenceSourcesClient } from '../../shared/ipc/intelligenceSourcesClient'
import { notifyIntelligenceSourcesChanged } from '../../shared/events/intelligenceSourcesChanged'
import { isSuccessfulCredentialOperation, resolveEnabledNotice, resolveRunNotice, toSaveProfileInput, upsertProfile, waitForRunHealth, withTimeout } from './intelligenceSourceProfileEditor'

export { isSuccessfulCredentialOperation }
import { buildSourceEnabledById } from './intelligenceSourceCatalogView'
import type { SettingsView } from '../../../service/intelligence/application/sourceProjection'

type HookState = {
  definitions: IntelligenceSourceDefinition[]
  profiles: IntelligenceSourceProfile[]
  focusMarketSettings: IntelligenceFocusMarketSettings
  selectedSourceId?: string
  detail?: SafeIntelligenceSourceDetailView
  draftProfile?: IntelligenceSourceProfile
  loading: boolean
  settingsView?: SettingsView
  saving: boolean
  savingFocusMarkets: boolean
  running: boolean
  testingCredentials: boolean
  replaying: boolean
  errorCode: string | null
  notice: string | null
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
    focusMarketSettings: { enabledFocusMarkets: ['global-macro', 'digital-assets'], updatedAt: '' },
    loading: true,
    saving: false,
    savingFocusMarkets: false,
    running: false,
    testingCredentials: false,
    replaying: false,
    errorCode: null,
    notice: null
  })
  const saveQueueRef = useRef(Promise.resolve())
  const pendingSaveCountRef = useRef(0)

  const load = useCallback(async (sourceId?: string) => {
    const [pageState, profiles, settingsView] = await Promise.all([
      intelligenceSourcesClient.getPageState(sourceId),
      intelligenceSourcesClient.listProfiles(),
      intelligenceSourcesClient.getSettingsView()
    ])
    setState((current) => ({
      ...current,
      definitions: pageState.definitions,
      profiles,
      focusMarketSettings: pageState.focusMarketSettings,
      selectedSourceId: pageState.selectedSourceId,
      detail: pageState.detail,
      settingsView,
      draftProfile: pageState.detail?.profile,
      loading: false,
      saving: false,
      errorCode: null
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

  const selectSource = useCallback(async (sourceId: string) => {
    setState((current) => ({ ...current, loading: true, errorCode: null }))
    try {
      await load(sourceId)
    } catch {
      setState((current) => ({ ...current, loading: false, errorCode: labels.loadFailed }))
    }
  }, [labels.loadFailed, load])

  const setEnabled = useCallback(
    (enabled: boolean) => {
      let previousProfile: IntelligenceSourceProfile | undefined
      let sourceId: string | undefined
      let blocked = false

      setState((current) => {
        if (!current.draftProfile) return current
        const definition = current.definitions.find((item) => item.sourceId === current.draftProfile?.sourceId)
        if (
          definition &&
          (definition.readiness === 'planned' || definition.readiness === 'fixture-ready') &&
          definition.collectionOwner !== 'product' &&
          enabled
        ) {
          blocked = true
          return current
        }
        previousProfile = current.draftProfile
        sourceId = current.draftProfile.sourceId
        return {
          ...current,
          draftProfile: { ...current.draftProfile, enabled },
          saving: true,
          errorCode: null
        }
      })

      if (blocked || !previousProfile || !sourceId) return

      pendingSaveCountRef.current += 1
      saveQueueRef.current = saveQueueRef.current
        .then(async () => {
          const detail = await withTimeout(
            intelligenceSourcesClient.saveProfile({ sourceId: sourceId!, enabled }),
            15_000
          )
          setState((current) => {
            const nextState = {
              ...current,
              profiles: upsertProfile(current.profiles, detail.profile),
              errorCode: null
            }
            if (current.selectedSourceId !== detail.profile.sourceId) {
              return nextState
            }
            return {
              ...nextState,
              detail,
              draftProfile: detail.profile,
              notice: resolveEnabledNotice(detail.profile, enabled, labels)
            }
          })
          notifyIntelligenceSourcesChanged()

          if (enabled && detail.profile.collectionPreset !== 'manual') {
            void waitForRunHealth(sourceId!)
              .then((health) => {
                setState((current) => {
                  if (current.selectedSourceId !== sourceId) return current
                  return {
                    ...current,
                    detail: current.detail ? { ...current.detail, health } : current.detail,
                    notice: resolveRunNotice(health, labels)
                  }
                })
              })
              .catch(() => undefined)
          }
        })
        .catch(() => {
          setState((current) => ({
            ...current,
            draftProfile:
              current.selectedSourceId === previousProfile?.sourceId ? previousProfile : current.draftProfile,
            errorCode: labels.saveFailed
          }))
        })
        .finally(() => {
          pendingSaveCountRef.current = Math.max(0, pendingSaveCountRef.current - 1)
          if (pendingSaveCountRef.current === 0) {
            setState((current) => ({ ...current, saving: false }))
          }
        })
    },
    [labels.disabledSaved, labels.enabledAutoCollectQueued, labels.enabledManualHint, labels.runFailed, labels.runQueued, labels.runSucceeded, labels.saveFailed]
  )

  const updateProfile = useCallback(
    (patch: Partial<IntelligenceSourceProfile>) => {
      let previousProfile: IntelligenceSourceProfile | undefined
      let nextProfile: IntelligenceSourceProfile | undefined

      setState((current) => {
        if (!current.draftProfile) return current
        previousProfile = current.draftProfile
        nextProfile = { ...current.draftProfile, ...patch }
        return {
          ...current,
          draftProfile: nextProfile,
          saving: true,
          errorCode: null
        }
      })

      if (!previousProfile || !nextProfile) return

      pendingSaveCountRef.current += 1
      saveQueueRef.current = saveQueueRef.current
        .then(async () => {
          const detail = await withTimeout(
            intelligenceSourcesClient.saveProfile(toSaveProfileInput(nextProfile!)),
            15_000
          )
          setState((current) => {
            const nextState = {
              ...current,
              profiles: upsertProfile(current.profiles, detail.profile),
              errorCode: null
            }
            if (current.selectedSourceId !== detail.profile.sourceId) {
              return nextState
            }
            return {
              ...nextState,
              detail,
              draftProfile: detail.profile,
              notice: labels.saved
            }
          })
          notifyIntelligenceSourcesChanged()
        })
        .catch(() => {
          setState((current) => ({
            ...current,
            draftProfile:
              current.selectedSourceId === previousProfile?.sourceId ? previousProfile : current.draftProfile,
            errorCode: labels.saveFailed
          }))
        })
        .finally(() => {
          pendingSaveCountRef.current = Math.max(0, pendingSaveCountRef.current - 1)
          if (pendingSaveCountRef.current === 0) {
            setState((current) => ({ ...current, saving: false }))
          }
        })
    },
    [labels.saved, labels.saveFailed]
  )

  /**
   * 按**源**改采集策略（频率档 / 范围 / 是否纳入舆情）。
   *
   * 与 `updateProfile` 同一套草稿队列与回滚，区别只在基准：那个改「当前选中的草稿」，这个改
   * 页面上任意一行——详情面板里每个源都常显这三行，读者不必先选中它。
   */
  const updateSourceProfile = useCallback(
    (sourceId: string, patch: Partial<IntelligenceSourceProfile>) => {
      let previous: IntelligenceSourceProfile | undefined
      let next: IntelligenceSourceProfile | undefined
      setState((current) => {
        const base = current.profiles.find((profile) => profile.sourceId === sourceId)
          ?? (current.draftProfile?.sourceId === sourceId ? current.draftProfile : undefined)
        if (!base) return current
        previous = base
        next = { ...base, ...patch }
        return {
          ...current,
          profiles: upsertProfile(current.profiles, next),
          draftProfile: current.draftProfile?.sourceId === sourceId ? next : current.draftProfile,
          saving: true,
          errorCode: null
        }
      })
      if (!previous || !next) return

      pendingSaveCountRef.current += 1
      saveQueueRef.current = saveQueueRef.current
        .then(async () => {
          const detail = await withTimeout(
            intelligenceSourcesClient.saveProfile(toSaveProfileInput(next!)),
            15_000
          )
          setState((current) => ({
            ...current,
            profiles: upsertProfile(current.profiles, detail.profile),
            errorCode: null,
            ...(current.selectedSourceId === detail.profile.sourceId
              ? { detail, draftProfile: detail.profile, notice: labels.saved }
              : {})
          }))
          notifyIntelligenceSourcesChanged()
        })
        .catch(() => {
          setState((current) => ({
            ...current,
            profiles: previous ? upsertProfile(current.profiles, previous) : current.profiles,
            draftProfile: current.draftProfile?.sourceId === previous?.sourceId ? previous : current.draftProfile,
            errorCode: labels.saveFailed
          }))
        })
        .finally(() => {
          pendingSaveCountRef.current = Math.max(0, pendingSaveCountRef.current - 1)
          if (pendingSaveCountRef.current === 0) {
            setState((current) => ({ ...current, saving: false }))
          }
        })
    },
    [labels.saved, labels.saveFailed]
  )

  const runNow = useCallback(async () => {
    if (!state.selectedSourceId) return
    const definition = state.definitions.find((item) => item.sourceId === state.selectedSourceId)
    if (
      definition?.readiness === 'planned' ||
      definition?.readiness === 'fixture-ready' ||
      definition?.supportsRunNow === false
    ) {
      return
    }
    setState((current) => ({ ...current, running: true, errorCode: null, notice: null }))
    try {
      await intelligenceSourcesClient.runNow(state.selectedSourceId)
      const health = await waitForRunHealth(state.selectedSourceId)
      setState((current) => ({
        ...current,
        running: false,
        detail: current.detail ? { ...current.detail, health } : current.detail,
        notice: resolveRunNotice(health, labels),
        errorCode:
          health.lastFailureAt && (!health.lastSuccessAt || health.lastFailureAt >= health.lastSuccessAt)
            ? labels.runFailed
            : null
      }))
    } catch {
      setState((current) => ({ ...current, running: false, errorCode: labels.runFailed }))
    }
  }, [labels, state.definitions, state.selectedSourceId])

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

  /**
   * 写「默认覆盖范围」，并把**这一处**的成败交回调用方：设置行的失败要就地显示（保留读者刚选的），
   * 与页面级 `errorCode` 不是同一件事——后者只在首屏读失败时用。
   */
  const saveFocusMarkets = useCallback(
    async (enabledFocusMarkets: IntelligenceFocusMarket[]): Promise<boolean> => {
      setState((current) => ({ ...current, savingFocusMarkets: true, errorCode: null }))
      try {
        const focusMarketSettings = await intelligenceSourcesClient.saveFocusSettings({ enabledFocusMarkets })
        setState((current) => ({
          ...current,
          focusMarketSettings,
          savingFocusMarkets: false,
          notice: labels.saved
        }))
        return true
      } catch {
        setState((current) => ({
          ...current,
          savingFocusMarkets: false,
          errorCode: labels.saveFailed
        }))
        return false
      }
    },
    [labels.saved, labels.saveFailed]
  )

  const sourceEnabledById = useMemo(
    () =>
      buildSourceEnabledById(
        state.definitions.map((definition) => definition.sourceId),
        state.profiles,
        state.draftProfile
      ),
    [state.definitions, state.draftProfile, state.profiles]
  )
  const needsManualRunPrompt = useMemo(() => {
    if (!state.draftProfile?.enabled || state.draftProfile.collectionPreset !== 'manual') return false
    const health = state.detail?.health
    return !health?.lastSuccessAt
  }, [state.detail?.health, state.draftProfile?.collectionPreset, state.draftProfile?.enabled])

  return {
    ...state,
    sourceEnabledById,
    needsManualRunPrompt,
    reload,
    selectSource,
    setEnabled,
    updateProfile,
    updateSourceProfile,
    runNow,
    testCredentials,
    replayWindow,
    refreshHealth,
    saveFocusMarkets
  }
}
