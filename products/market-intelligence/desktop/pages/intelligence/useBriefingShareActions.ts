import { useEffect, useRef, useState } from 'react'
import { toPng } from 'html-to-image'

import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import type { DailyBriefingDocument, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import { dailyBriefingToMarkdown } from '../../../contracts/dailyBriefingMarkdown'
import { localizedDirectionTerm } from './analysisConclusionDirectionPolicy'
import { BRIEFING_PAPER_WIDTH, briefingExportFileName, posterExportBackground } from './dailyBriefingExport'
import { briefingTextForLocale, type DailyBriefingText } from './dailyBriefingText'
import { withWindowHours } from './dailyBriefingWindowText'

/**
 * The two things a reader can take away from an edition: a copied text version and a PNG poster.
 *
 * Both are "do it once, then say so for a moment", so each keeps its own transient state and timer
 * — and the timers are cleared on unmount, because a page closed mid-export must not write state
 * into a component that no longer exists. Extracted from the page: it is a capability with its own
 * resources, not page layout.
 */
export type BriefingExportState = 'idle' | 'exporting' | 'done' | 'failed'
export type BriefingCopyState = 'idle' | 'copied' | 'failed'

export function useBriefingShareActions(deps: Readonly<{
  document: DailyBriefingDocument | undefined
  locale: DailyBriefingLocale
  text: DailyBriefingText
  eventTitles?: Readonly<Record<string, string>>
  /** The poster element the image export reads; absent means the screen has nothing to export. */
  shareRef: React.RefObject<HTMLDivElement | null>
}>): Readonly<{
  exportState: BriefingExportState
  copyState: BriefingCopyState
  exportImage: () => Promise<void>
  copy: () => Promise<void>
}> {
  const formatTime = useShellTimeFormat()
  const [exportState, setExportState] = useState<BriefingExportState>('idle')
  const [copyState, setCopyState] = useState<BriefingCopyState>('idle')
  const exportTimer = useRef<number | undefined>(undefined)
  const copyTimer = useRef<number | undefined>(undefined)
  // `document` is the briefing being shared; the DOM's document is reached as `globalThis.document`.
  const { document: briefing, locale, text, eventTitles, shareRef } = deps

  useEffect(() => () => {
    if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current)
    if (exportTimer.current !== undefined) window.clearTimeout(exportTimer.current)
  }, [])

  const exportImage = async (): Promise<void> => {
    if (!briefing || !shareRef.current) return
    setExportState('exporting')
    try {
      // The poster paints its own paper; the export reads that colour back instead of keeping a
      // second copy here, so a palette change cannot leave the downloaded image on the old paper.
      const poster = shareRef.current.querySelector<HTMLElement>('.mi-brief-poster') ?? shareRef.current
      // The export must read the sheet at its printed width. A measured width of 0 is a DOM without
      // layout (a test), where there is nothing to check; anything else that is not 1080 would produce
      // a smaller, softer image without raising an error, which is the failure worth refusing.
      const measured = Math.round(poster.getBoundingClientRect().width)
      if (measured > 0 && measured !== BRIEFING_PAPER_WIDTH) {
        setExportState('failed')
        return
      }
      const paper = posterExportBackground(poster)
      const dataUrl = await toPng(poster, { pixelRatio: 2, ...(paper ? { backgroundColor: paper } : {}), width: 1080, cacheBust: true })
      const link = document.createElement('a')
      link.download = briefingExportFileName(briefing)
      link.href = dataUrl
      link.click()
      setExportState('done')
    } catch {
      setExportState('failed')
    }
    if (exportTimer.current !== undefined) window.clearTimeout(exportTimer.current)
    exportTimer.current = window.setTimeout(() => setExportState('idle'), 2_500)
  }

  const copy = async (): Promise<void> => {
    if (!briefing) return
    try {
      const markdown = dailyBriefingToMarkdown(briefing, {
        labels: (() => {
          const base = withWindowHours(briefing.edition.locale === locale ? text : briefingTextForLocale(briefing.edition.locale), briefing.edition.windowHours ?? 24)
          // 语言名住在设置块里，而复制头部要的是"这一份是哪一语言"——搬上来一次，不另存一份词表。
          return { ...base, languageNames: base.settings.languageNames as Readonly<Record<string, string>> }
        })(),
        locale: briefing.edition.locale,
        direction: (term) => localizedDirectionTerm(term, briefing.edition.locale),
        ...(eventTitles ? { eventTitle: (item) => item.titleKey ? eventTitles[item.titleKey] ?? item.title : item.title } : {}),
        formatTime: (value) => formatTime(value, 'minute')
      })
      if (!navigator.clipboard?.writeText) throw new Error('clipboard-unavailable')
      await navigator.clipboard.writeText(markdown)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
    if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopyState('idle'), 2_000)
  }

  return { exportState, copyState, exportImage, copy }
}
