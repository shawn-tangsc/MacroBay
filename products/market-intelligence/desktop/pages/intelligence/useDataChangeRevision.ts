import { useCallback, useEffect, useRef, useState } from 'react'

import type { PanelId } from '../../../service/intelligence/application/providerRegistry'
import type { IntelligenceDataChangedPayload } from '../../../contracts/intelligenceDataChangedEvent'
import { subscribeIntelligenceDataChanged, type ProductEventSubscribe } from '../../shared/ipc/intelligenceDataChangedClient'
import { useVisibleInterval } from '../../shared/useVisibleInterval'

/** 兜底轮询的间隔：信号全丢时的最坏陈旧上限（这些数据都是分钟级事实）。 */
export const dataChangeFallbackIntervalMs = 5 * 60_000

/**
 * 「采集写了库」在一个面板上的重读计数。
 *
 * 一处订阅、一处重读：读口由谁发起、谁持有那份 state，谁调这个 hook。卡片只拿 `revision`
 * 当输入，不自己订阅、不写「我依赖哪些源」的映射——那层映射在发射端按注册表算。
 *
 * - 命中 `panel` 才 +1，其余面板的事件一概不理会（不重读、不 setState）；
 * - 同一次渲染里到几条只算一次（React 批处理），所以重复投递不会发起两轮并发读；
 * - 兜底 5 分钟一轮，只在页面可见时走。
 */
export function useDataChangeRevision(input: Readonly<{
  panel: PanelId
  /** 用例注入的订阅口；真实宿主走产品事件通道。 */
  subscribe?: ProductEventSubscribe
}>): number {
  const [revision, setRevision] = useState(0)
  const bump = useCallback(() => { setRevision(current => current + 1) }, [])
  const { panel, subscribe } = input

  useEffect(() => subscribeIntelligenceDataChanged((payload: IntelligenceDataChangedPayload) => {
    if (!payload.panels.includes(panel)) return
    setRevision(current => current + 1)
  }, subscribe), [panel, subscribe])

  useVisibleInterval(dataChangeFallbackIntervalMs, bump)

  return revision
}

/**
 * 一次运行是不是「后台重读」。
 *
 * `revision` 变了就是采集写了库：这次重读**不清空读数、不置 loading**，失败沿用上一次——
 * 与读者的「再试一次」不是一回事（那次要看得见重新问了）。首次挂载不算后台重读。
 *
 * 判定放进 effect 再用，不在渲染里改 ref：StrictMode 的双渲染会把标记吃掉。
 */
export function trackQuietRevision(
  previous: { current: number | undefined },
  revision: number | undefined
): boolean {
  const quiet = previous.current !== undefined && previous.current !== revision
  previous.current = revision
  return quiet
}
