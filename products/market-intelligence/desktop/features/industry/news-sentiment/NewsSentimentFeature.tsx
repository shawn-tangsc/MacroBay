import { useCallback, useEffect, useState } from 'react'

import type { NewsSentimentClient } from '../../../shared/ipc/newsSentimentClient'
import { newsSentimentClient } from '../../../shared/ipc/newsSentimentClient'
import { intelligenceSourcesClient } from '../../../shared/ipc/intelligenceSourcesClient'
import { NEWS_SENTIMENT_SOURCE_IDS } from '../../../../service/intelligence/schema/newsSentiment'
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
  text: NewsSentimentText
  client?: NewsSentimentClient
  now?: () => Date
}): React.ReactElement {
  const client = props.client ?? newsSentimentClient
  const now = props.now ?? (() => new Date())
  const state = useNewsSentiment({ client, now })
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [focusItemId, setFocusItemId] = useState<string>()
  const [enabling, setEnabling] = useState(false)
  const [enableFailed, setEnableFailed] = useState(false)
  const [enabledSourceIds, setEnabledSourceIds] = useState<string[]>([])
  const [collecting, setCollecting] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const loadSourceState = useCallback(async () => {
    try {
      const profiles = await intelligenceSourcesClient.listProfiles()
      setEnabledSourceIds(
        profiles
          .filter((profile) => (NEWS_SENTIMENT_SOURCE_IDS as readonly string[]).includes(profile.sourceId) && profile.enabled)
          .map((profile) => profile.sourceId)
      )
    } catch {
      setEnabledSourceIds([])
    }
  }, [])

  useEffect(() => {
    void loadSourceState()
    const onFocus = () => { void loadSourceState() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [loadSourceState])

  const collectNow = useCallback(async () => {
    setCollecting(true)
    try {
      for (const sourceId of enabledSourceIds) await intelligenceSourcesClient.runNow(sourceId)
    } finally {
      setCollecting(false)
      state.refresh()
    }
  }, [enabledSourceIds, state])

  const enableSources = useCallback(async () => {
    setEnabling(true)
    setEnableFailed(false)
    try {
      for (const sourceId of ['sec-rss', 'coindesk-rss', 'binance-announcements', 'okx-latest-announcements']) {
        await intelligenceSourcesClient.setEnabled(sourceId, true)
        await intelligenceSourcesClient.runNow(sourceId)
      }
      await loadSourceState()
      state.refresh()
    } catch {
      setEnableFailed(true)
    } finally {
      setEnabling(false)
    }
  }, [loadSourceState, state])

  return (
    <>
      <NewsSentimentCard
        failed={state.failed}
        loading={state.loading}
        onOpenAll={() => setDrawerOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onRefresh={state.refresh}
        onSelectItem={(item) => { setFocusItemId(item.itemId); setDrawerOpen(true) }}
        onEnableSources={() => void enableSources()}
        onCollectNow={() => void collectNow()}
        enablingSources={enabling}
        collecting={collecting}
        enableSourcesFailed={enableFailed}
        enabledSourceCount={enabledSourceIds.length}
        onWindowChange={state.setWindow}
        text={props.text}
        view={state.view}
        window={state.window}
      />
      <NewsSentimentDrawer
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
      />
      <NewsSentimentSettingsModal
        client={client}
        onClose={() => setSettingsOpen(false)}
        open={settingsOpen}
        text={props.text}
      />
    </>
  )
}
