import { useState } from 'react'

import { useStateViewText } from '@platform/ui/components/state/stateViewText'

import type { NewsSentimentClient } from '../../../shared/ipc/newsSentimentClient'
import { newsSentimentClient } from '../../../shared/ipc/newsSentimentClient'
import { intelligenceSourcesClient } from '../../../shared/ipc/intelligenceSourcesClient'
import { NEWS_SENTIMENT_SOURCE_IDS } from '../../../../service/intelligence/schema/newsSentiment'
import type { NewsSentimentWindow } from '../../../../service/intelligence/schema/newsSentiment'
import type { NewsSentimentText } from './NewsSentimentCard'
import { NewsSentimentCard } from './NewsSentimentCard'
import { NewsSentimentDrawer } from './NewsSentimentDrawer'
import { NewsSentimentSettingsModal } from './NewsSentimentSettingsModal'
import { useNewsSentiment } from './useNewsSentiment'

import './newsSentiment.css'

/**
 * 右列的舆情卡 + 全量抽屉 + 模型设置。读取只有一处（useNewsSentiment），
 * 卡片与抽屉共享同一个窗口状态，避免两处各读一份。
 */
export function NewsSentimentFeature(props: {
  language?: 'zh-CN' | 'en-US'
  text: NewsSentimentText
  client?: NewsSentimentClient
  now?: () => Date
  /** Tests shorten the read deadline; production uses the hook's default. */
  readDeadlineMs?: number
  /** Injected in tests; production reads the product's own source client. */
  sourcesClient?: {
    runNow: (sourceId: string) => Promise<unknown>
    setEnabled?: (sourceId: string, enabled: boolean) => Promise<unknown>
  }
  /** Publish the clicked item so the agent can start from that story. */
  onSelectContext?: (item: import('../../../../service/intelligence/news-sentiment/newsSentimentQuery').NewsSentimentItemView) => void
}): React.ReactElement {
  const client = props.client ?? newsSentimentClient
  const sourcesClient = props.sourcesClient ?? intelligenceSourcesClient
  const now = props.now ?? (() => new Date())
  const state = useNewsSentiment({
    client,
    now,
    language: props.language ?? 'zh-CN',
    ...(props.readDeadlineMs === undefined ? {} : { readDeadlineMs: props.readDeadlineMs })
  })
  const refresh = state.refresh
  // The `older-than-window` state advertises "widen the time window"; this is that action, and it must
  // really change the window (a plain re-read would leave the same emptiness on screen).
  const WINDOW_ORDER: NewsSentimentWindow[] = ['1h', '4h', '24h', '7d', 'all']
  const widenWindow = (): void => {
    const next = WINDOW_ORDER[Math.min(WINDOW_ORDER.indexOf(state.window) + 1, WINDOW_ORDER.length - 1)]
    if (next && next !== state.window) state.setWindow(next)
  }
  // One click collects the named sources and re-reads. A collection that fails on one source must
  // not swallow the others, so the promises are settled independently.
  const runSources = (sourceIds: readonly string[]): void => {
    void Promise.allSettled(sourceIds.map((sourceId) => sourcesClient.runNow(sourceId))).then(() => refresh())
  }
  // "Enable" must enable: turn the four sources on, collect once so the card has something to show,
  // then re-read. A button that only opened settings would be a different label, not this one.
  const enableSources = (): void => {
    if (typeof sourcesClient.setEnabled !== 'function') return
    void Promise.allSettled(NEWS_SENTIMENT_SOURCE_IDS.map((sourceId) => sourcesClient.setEnabled!(sourceId, true)))
      .then(() => Promise.allSettled(NEWS_SENTIMENT_SOURCE_IDS.map((sourceId) => sourcesClient.runNow(sourceId))))
      .then(() => refresh())
  }
  // English is the source language for the feed, so the English UI has no translation surface.
  // Any future non-English UI language reuses the same controls and translates into that language.
  const language = props.language ?? 'zh-CN'
  const translationEnabled = language !== 'en-US'
  // StateView prints platform state sentences; the product only chooses the state and its code.
  // 语言来自壳层上下文——产品不许自带语言参数，也不再从 app 层借解析函数。
  const resolveStateText = useStateViewText()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [focusItemId, setFocusItemId] = useState<string>()

  return (
    <>
      <NewsSentimentCard
        failed={state.failed}
        loading={state.loading}
        onOpenAll={() => setDrawerOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onEnableSources={enableSources}
        onRefresh={state.refresh}
        onRunSources={runSources}
        onWidenWindow={widenWindow}
        includeNeutral={state.filters.includeNeutral}
        onIncludeNeutralChange={(includeNeutral) => state.setFilters({ includeNeutral })}
        onSelectItem={(item) => { setFocusItemId(item.itemId); setDrawerOpen(true); props.onSelectContext?.(item) }}
        text={props.text}
        view={state.view}
      />
      <NewsSentimentDrawer
        translationEnabled={translationEnabled}
        client={client}
        failed={state.failed}
        filters={state.filters}
        focusItemId={focusItemId}
        loading={state.loading}
        onClose={() => setDrawerOpen(false)}
        onFilters={state.setFilters}
        onOpenSettings={() => setSettingsOpen(true)}
        onRefresh={state.refresh}
        onWindowChange={state.setWindow}
        open={drawerOpen}
        text={props.text}
        view={state.view}
        window={state.window}
        resolveStateText={resolveStateText}
      />
      <NewsSentimentSettingsModal
          showTranslation={translationEnabled}
        client={client}
        onClose={() => setSettingsOpen(false)}
        open={settingsOpen}
        text={props.text}
      />
    </>
  )
}
