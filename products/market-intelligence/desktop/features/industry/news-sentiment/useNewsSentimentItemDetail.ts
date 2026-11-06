import { useEffect, useState } from 'react'

import type { NewsSentimentItemDetail } from '../../../../service/intelligence/news-sentiment/newsSentimentQuery'
import type { NewsSentimentClient } from '../../../shared/ipc/newsSentimentClient'

/**
 * 抽屉右侧正文那一次读取。
 *
 * 单独成 hook 的理由是这里有三条容易写错、又都和渲染无关的规则：换行时必须先把上一篇正文
 * 清掉（旧正文挂在新标题下等于说「这一行讲了那个」）、读失败不能留着旧正文、以及卸载或快速
 * 换行时晚到的回包要丢掉。放在组件里会散在 JSX 中间，看不出它们其实是一件事。
 */
export function useNewsSentimentItemDetail(input: {
  open: boolean
  itemId: string | undefined
  asOf: string | undefined
  client: Pick<NewsSentimentClient, 'getItem'>
}): {
  detail: NewsSentimentItemDetail | undefined
  detailFailed: boolean
  detailLoading: boolean
} {
  const { open, itemId, asOf, client } = input
  const [detail, setDetail] = useState<NewsSentimentItemDetail>()
  const [detailFailed, setDetailFailed] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)

  // The drawer's content stays mounted between opens, so closing has to drop the article here:
  // otherwise a reopened drawer shows the one read last time under a new row's selection.
  useEffect(() => {
    if (open) return
    setDetail(undefined)
    setDetailFailed(false)
    setDetailLoading(false)
  }, [open])

  useEffect(() => {
    if (!open || !itemId || !asOf) return
    let cancelled = false
    // Drop the previous article before the next read: a stale body under a new heading reads as
    // "this row says that", and a failed read must not leave it in place either.
    setDetail(undefined)
    setDetailFailed(false)
    setDetailLoading(true)
    void client
      .getItem({ itemId, asOf })
      .then((next) => {
        if (cancelled) return
        setDetailLoading(false)
        if (next?.itemId === itemId) setDetail(next)
      })
      .catch(() => {
        if (cancelled) return
        setDetailLoading(false)
        setDetailFailed(true)
      })
    return () => { cancelled = true }
  }, [open, itemId, asOf, client])

  return { detail, detailFailed, detailLoading }
}
