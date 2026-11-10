import { useState } from 'react'

import { useStateViewText } from '@platform/ui/components/state/stateViewText'

import type { NewsSentimentClient } from '../../../shared/ipc/newsSentimentClient'
import { newsSentimentClient } from '../../../shared/ipc/newsSentimentClient'
import type { NewsSentimentWindow } from '../../../../service/intelligence/schema/newsSentiment'
import type { NewsSentimentText } from './NewsSentimentCard'
import { NewsSentimentCard } from './NewsSentimentCard'
import { NewsSentimentDrawer } from './NewsSentimentDrawer'
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
  /**
   * 宿主给「打开设置」的去处时调它（现在指：打开配置抽屉并停在内容处理屏）。
   * **不传就退回本地弹框**——判空与回落写在同一处，别在外面再包一层 if。
   */
  onOpenSettings?: (focus: Readonly<{ section: 'sentiment' }>) => void
  /**
   * 「来源没有启用」的去处：**只打开配置抽屉，不替读者开源**。
   * 唯一编辑入口是「采集与数据」那一屏，这里最多把落点讲清楚（`business: 'sentiment'`）。
   */
  onOpenSources?: (focus: Readonly<{ business: 'sentiment' }>) => void
  /** Publish the clicked item so the agent can start from that story. */
  onSelectContext?: (item: import('../../../../service/intelligence/news-sentiment/newsSentimentQuery').NewsSentimentItemView) => void
}): React.ReactElement {
  const client = props.client ?? newsSentimentClient
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
  // English is the source language for the feed, so the English UI has no translation surface.
  // Any future non-English UI language reuses the same controls and translates into that language.
  const language = props.language ?? 'zh-CN'
  const translationEnabled = language !== 'en-US'
  // StateView prints platform state sentences; the product only chooses the state and its code.
  // 语言来自壳层上下文——产品不许自带语言参数，也不再从 app 层借解析函数。
  const resolveStateText = useStateViewText()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [focusItemId, setFocusItemId] = useState<string>()

  return (
    <>
      <NewsSentimentCard
        failed={state.failed}
        loading={state.loading}
        onOpenAll={() => setDrawerOpen(true)}
        onOpenSettings={props.onOpenSettings === undefined ? undefined : () => props.onOpenSettings!({ section: 'sentiment' })}
        onOpenSources={props.onOpenSources}
        onRefresh={state.refresh}
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
        onOpenSettings={props.onOpenSettings === undefined ? undefined : () => props.onOpenSettings!({ section: 'sentiment' })}
        onRefresh={state.refresh}
        onWindowChange={state.setWindow}
        open={drawerOpen}
        text={props.text}
        view={state.view}
        window={state.window}
        resolveStateText={resolveStateText}
      />
    </>
  )
}
