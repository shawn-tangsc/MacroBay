import { useState } from 'react'

import type { NewsSentimentClient } from '../../../shared/ipc/newsSentimentClient'
import { newsSentimentClient } from '../../../shared/ipc/newsSentimentClient'
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
  /** Publish the clicked item so the agent can start from that story. */
  onSelectContext?: (item: import('../../../../service/intelligence/news-sentiment/newsSentimentQuery').NewsSentimentItemView) => void
}): React.ReactElement {
  const client = props.client ?? newsSentimentClient
  const now = props.now ?? (() => new Date())
  const state = useNewsSentiment({ client, now })
  // English is the source language for the feed, so the English UI has no translation surface.
  // Any future non-English UI language reuses the same controls and translates into that language.
  const translationEnabled = (props.language ?? 'zh-CN') !== 'en-US'
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
        onRefresh={state.refresh}
        onSelectContext={props.onSelectContext}
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
        onSelectContext={props.onSelectContext}
        onWindowChange={state.setWindow}
        open={drawerOpen}
        text={props.text}
        view={state.view}
        window={state.window}
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
