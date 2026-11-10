import { useCallback, useEffect, useState } from 'react'

import { intelligenceSourcesClient } from '../../shared/ipc/intelligenceSourcesClient'
import type { SourceDetailRead } from './SourceHealthDetail'
import type { ProviderView, SourceView } from '../../../service/intelligence/application/sourceProjection'

/**
 * 每个源的详情读取（四格的数据来源）。从 `ProviderDetail` 抽出来，两个理由：
 * 1. 那支文件已经顶到体积门禁，这段自带判据、几乎不碰父组件状态；
 * 2. 「读失败是一种状态」这条规矩只该有一处实现——日历 feed 不读通用详情、刷新不把四格闪空，
 *    都收在这一个 hook 里。
 */
export function isCalendarSource(source: Readonly<{ kind: string }>): boolean {
  return source.kind === 'official-calendar' || source.kind === 'market-calendar'
}

export function useSourceDetailReads(provider: ProviderView, showSourceDetails: boolean | undefined): Readonly<{
  details: Record<string, SourceDetailRead>
  retryDetail: (sourceId: string) => void
  refreshDetail: (sourceId: string) => Promise<void>
}> {
  const [details, setDetails] = useState<Record<string, SourceDetailRead>>({})

  const loadDetail = useCallback(async (sourceId: string, active: () => boolean): Promise<void> => {
    setDetails((current) => ({ ...current, [sourceId]: { state: 'loading' } }))
    try {
      const state = await intelligenceSourcesClient.getPageState(sourceId)
      if (!active()) return
      const detail = state?.detail
      setDetails((current) => ({
        ...current,
        [sourceId]: detail === undefined ? { state: 'failed' } : { state: 'ready', detail }
      }))
    } catch {
      if (!active()) return
      setDetails((current) => ({ ...current, [sourceId]: { state: 'failed' } }))
    }
  }, [])

  useEffect(() => {
    if (showSourceDetails !== true) return
    let active = true
    const sources = provider.sources.filter((source) => !isCalendarSource(source))
    setDetails((current) => {
      const next: Record<string, SourceDetailRead> = {}
      for (const source of provider.sources) {
        next[source.sourceId] = isCalendarSource(source)
          ? { state: 'skipped' }
          // 同一屏重渲染时保留已读到的结果：重读由「重试」触发，不因为父级刷新把四格闪空。
          : current[source.sourceId]?.state === 'ready' ? current[source.sourceId]! : { state: 'loading' }
      }
      return next
    })
    for (const source of sources) void loadDetail(source.sourceId, () => active)
    return () => { active = false }
  }, [provider.providerId, showSourceDetails, loadDetail])

  /** 读失败后的重试：重新问这一次源，不改任何设置。 */
  const retryDetail = useCallback((sourceId: string): void => {
    void loadDetail(sourceId, () => true)
  }, [loadDetail])

  /**
   * 跑完**后台刷新**这个源的详情：健康读数会变（上次成功 / 今天有没有读数）。
   *
   * 不把它画成 `loading`——那会把整块四格（连同刚显示出来的「跑了什么结果」）卸载再重挂，
   * 读者会看到行闪一下、结果也没了。刷新失败保留旧读数，四格不空。
   */
  const refreshDetail = useCallback(async (sourceId: string): Promise<void> => {
    try {
      const state = await intelligenceSourcesClient.getPageState(sourceId)
      const detail = state?.detail
      if (detail !== undefined) {
        setDetails((current) => ({ ...current, [sourceId]: { state: 'ready' as const, detail } }))
      }
    } catch {
      // 刷新是补充，不是主读：失败不把已经显示的四格抹掉。
    }
  }, [])

  return { details, retryDetail, refreshDetail }
}

/** 只需要 `kind` 的调用点（标签行）用这一份，避免再抄一遍 kind 判断。 */
export function sourceNeedsCalendarBadge(source: Pick<SourceView, 'kind'>): boolean {
  return isCalendarSource(source)
}
