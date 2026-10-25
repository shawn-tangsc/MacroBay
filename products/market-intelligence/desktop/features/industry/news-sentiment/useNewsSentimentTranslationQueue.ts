import { useCallback, useRef, useState } from 'react'

import type { NewsSentimentItemView, NewsSentimentView } from '../../../../service/intelligence/news-sentiment/newsSentimentQuery'
import type { NewsSentimentClient } from '../../../shared/ipc/newsSentimentClient'

const TRANSLATION_CONCURRENCY = 5

export type TranslationQueueState = 'waiting' | 'translating' | 'translated' | 'failed'

/**
 * Owns the manual body-translation queue. The drawer renders it, but the queue does not know about
 * rows, filters or layout; callers pass the visible rows to `translateAll`.
 */
export function useNewsSentimentTranslationQueue(input: {
  client: Pick<NewsSentimentClient, 'translateBody'>
  view?: NewsSentimentView
  onRefresh: () => void
}) {
  const [translationStates, setTranslationStates] = useState<Record<string, TranslationQueueState>>({})
  const [translatedBodies, setTranslatedBodies] = useState<Record<string, string>>({})
  const [translatedTitles, setTranslatedTitles] = useState<Record<string, string>>({})
  const [translatingAll, setTranslatingAll] = useState(false)
  const runIdRef = useRef(0)

  const translateItem = useCallback(async (itemId: string, force = false) => {
    const row = (input.view?.items ?? []).find((entry) => entry.itemId === itemId)
    if (!force && (row?.bodyTranslationState === 'translated' || translatedBodies[itemId])) return
    setTranslationStates((current) => ({ ...current, [itemId]: 'translating' }))
    const clientTranslate = typeof input.client.translateBody === 'function'
      ? input.client.translateBody
      : (id: string, retranslate?: boolean) => {
          const products = window.platform?.products
          if (!products?.invoke) return Promise.reject(new Error('Product IPC bridge is unavailable.'))
          return products.invoke('market-intelligence', 'intelligence.translateNewsSentimentBody', { itemId: id, force: retranslate }) as Promise<{ state: 'translated' | 'off' | 'unavailable' | 'failed'; body?: string; title?: string }>
        }
    try {
      const result = await clientTranslate(itemId, force)
      if (result.state === 'translated' && result.body) {
        setTranslatedBodies((current) => ({ ...current, [itemId]: result.body! }))
        if (result.title) setTranslatedTitles((current) => ({ ...current, [itemId]: result.title! }))
        setTranslationStates((current) => ({ ...current, [itemId]: 'translated' }))
        window.setTimeout(() => input.onRefresh(), 800)
      } else {
        setTranslationStates((current) => ({ ...current, [itemId]: 'failed' }))
      }
    } catch {
      setTranslationStates((current) => ({ ...current, [itemId]: 'failed' }))
    }
  }, [input.client, input.onRefresh, input.view, translatedBodies])

  const translateAll = useCallback(async (rows: readonly NewsSentimentItemView[]) => {
    const pending = rows.filter((row) => (translationStates[row.itemId] ?? row.bodyTranslationState) !== 'translated')
    if (pending.length === 0) return
    const runId = runIdRef.current + 1
    runIdRef.current = runId
    setTranslatingAll(true)
    const concurrency = Math.min(TRANSLATION_CONCURRENCY, pending.length)
    setTranslationStates((current) => {
      const next = { ...current }
      for (const row of pending) if (!next[row.itemId]) next[row.itemId] = 'waiting'
      for (const row of pending.slice(0, concurrency)) next[row.itemId] = 'translating'
      return next
    })
    let cursor = 0
    const workers = Array.from({ length: concurrency }, async () => {
      while (runIdRef.current === runId && cursor < pending.length) {
        const row = pending[cursor]
        cursor += 1
        if (!row) continue
        if (translatedBodies[row.itemId]) {
          setTranslationStates((current) => ({ ...current, [row.itemId]: 'translated' }))
          continue
        }
        setTranslationStates((current) => ({ ...current, [row.itemId]: 'translating' }))
        await translateItem(row.itemId)
      }
    })
    await Promise.all(workers)
    if (runIdRef.current === runId) {
      setTranslatingAll(false)
      input.onRefresh()
    }
  }, [input.onRefresh, translateItem, translationStates, translatedBodies])

  const cancelTranslation = useCallback(() => {
    runIdRef.current += 1
    setTranslatingAll(false)
    setTranslationStates((current) => {
      const next = { ...current }
      for (const [itemId, state] of Object.entries(next)) if (state === 'waiting') delete next[itemId]
      return next
    })
  }, [])

  return {
    translationStates,
    translatedBodies,
    translatedTitles,
    translatingAll,
    translateItem,
    translateAll,
    cancelTranslation
  }
}
