import { useEffect, useState } from 'react'

import { formatShellInstant, type ShellTimePrecision } from '@platform/ui/time/shellTimeFormat'

import type { DailyBriefingDocument, DailyBriefingEditionSummary, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import { productText } from '../../shared/i18n/productText'
import { dailyBriefingClient, type DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import { DailyBriefingShareCard } from './DailyBriefingShareCard'
import {
  briefingChangeArrows,
  briefingFearGreedBuckets,
  briefingPaymentDirections,
  briefingPolicyGaugeWords
} from './dailyBriefingPaymentDirections'
import { posterProps } from './dailyBriefingPoster'
import { BRIEFING_PAPER_WIDTH } from './dailyBriefingExport'
import './dailyBriefingShareCard.css'

/**
 * 海报窗口：主进程起一个不显示的窗口，只为把**这一版**画成一张 1080 宽的图。
 *
 * 与页面导出**同源**，不是另写一份版面：
 * - 文案与完整性说明句一律走 `posterProps`（唯一决定「图跟版次语言、不跟界面语言」的地方，
 *   而且它要读版次摘要才出得出那句说明）；这里不选语言、不拼 props、不拼句子。
 * - 卡片是同一个 `DailyBriefingShareCard`，样式是同一份 CSS。
 *
 * 就绪判据写进 `documentElement.dataset`：主进程轮询它（不新开 IPC），到了才截图。
 * 失败也写：`failed` 带原因——「没画出来」与「画出来但不合格」不能都变成一句沉默。
 */
const STATE = 'posterState'
const ERROR = 'posterError'
const WIDTH = 'posterWidth'

export type BriefingPosterWindowProps = Readonly<{
  params: URLSearchParams
  client?: DailyBriefingClient
}>

/** 窗口参数：哪一版。缺一个就画不了，直接落失败，不去猜「今天」。 */
export function briefingPosterTarget(params: URLSearchParams): Readonly<{
  date: string
  periodId: string
  locale: DailyBriefingLocale
}> | null {
  const date = params.get('date') ?? ''
  const periodId = params.get('periodId') ?? ''
  const rawLocale = params.get('locale')
  const locale: DailyBriefingLocale | null = rawLocale === 'en-US' ? 'en-US' : rawLocale === 'zh-CN' ? 'zh-CN' : null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || periodId.length === 0 || locale === null) return null
  return { date, periodId, locale }
}

/** 主进程读这两个标记；写在一个地方，别处不要各写一份属性名。 */
export function markBriefingPosterState(state: 'ready' | 'failed', detail?: string): void {
  const root = document.documentElement
  root.dataset[STATE] = state
  if (detail === undefined) delete root.dataset[ERROR]
  else root.dataset[ERROR] = detail
}

export default function BriefingPosterWindow({ params, client = dailyBriefingClient }: BriefingPosterWindowProps): React.ReactElement | null {
  const target = briefingPosterTarget(params)
  const [briefing, setBriefing] = useState<DailyBriefingDocument | undefined>(undefined)
  const [editions, setEditions] = useState<readonly DailyBriefingEditionSummary[]>([])
  const date = target?.date
  const periodId = target?.periodId
  const locale = target?.locale

  useEffect(() => {
    if (date === undefined || periodId === undefined || locale === undefined) {
      markBriefingPosterState('failed', 'invalid-params')
      return
    }
    let alive = true
    void (async () => {
      // 与页面同一条只读路径：版次用 `get`、摘要用 `list`。摘要不是可选项——没有它
      // `posterProps` 出不来完整性说明句，推出去的图会静默比页面少一句。
      const [edition, listed] = await Promise.all([
        client.get({ date, locale, periodId }),
        client.list({ locale, timeZone: 'UTC', generate: false })
      ])
      if (!alive) return
      if (edition.state !== 'available') {
        const reason = edition.state === 'missing' ? 'edition-missing' : 'edition-unavailable'
        markBriefingPosterState('failed', reason)
        return
      }
      setBriefing(edition.document)
      setEditions(listed.state === 'available' ? listed.result.editions : [])
    })()
    return () => { alive = false }
  }, [client, date, locale, periodId])

  // 就绪：字体就位 → 两帧 → 宽必须是印刷宽。宽度不对**不截**，直接判失败：
  // 截一张 900 宽的图不会报错，读者只会拿到一张糊的。
  useEffect(() => {
    if (briefing === undefined) return
    let cancelled = false
    void (async () => {
      await globalThis.document.fonts.ready
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (cancelled) return
        const poster = globalThis.document.querySelector<HTMLElement>('.mi-brief-poster')
        const width = Math.round(poster?.getBoundingClientRect().width ?? 0)
        globalThis.document.documentElement.dataset[WIDTH] = String(width)
        if (width !== BRIEFING_PAPER_WIDTH) {
          markBriefingPosterState('failed', `width-${width}`)
          return
        }
        markBriefingPosterState('ready')
      }))
    })()
    return () => { cancelled = true }
  }, [briefing])

  if (briefing === undefined) return null

  const editionLocale = briefing.edition.locale
  const poster = posterProps({
    document: briefing,
    editions,
    fallbackText: productText[editionLocale].pages.intelligence.portal.dashboard.dailyBriefing
  })
  const fontLocale = poster.locale
  const timeZone = briefing.edition.timeZone
  const formatTime = (value: string, precision: ShellTimePrecision = 'minute') =>
    formatShellInstant(value, { timeZone, locale: fontLocale, precision })

  return (
    <div
      data-briefing-poster-surface
      style={{ position: 'absolute', top: 0, left: 0, width: BRIEFING_PAPER_WIDTH, margin: 0, padding: 0 }}
    >
      <DailyBriefingShareCard
        document={briefing}
        text={poster.text}
        locale={fontLocale}
        paymentDirectionsCompact={briefingPaymentDirections(fontLocale)}
        policyWords={briefingPolicyGaugeWords(fontLocale)}
        changeArrows={briefingChangeArrows(fontLocale)}
        fearGreedBuckets={briefingFearGreedBuckets(fontLocale)}
        {...(poster.completenessNote === undefined ? {} : { completenessNote: poster.completenessNote })}
        formatTime={formatTime}
        timeZone={timeZone}
      />
    </div>
  )
}