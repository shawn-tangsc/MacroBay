import { useEffect, useState } from 'react'
import { CalendarClock, Check, X } from 'lucide-react'

import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import type { DailyBriefingEditionSummary, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import { dailyBriefingClient, type DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'

import './dailyBriefingGeneratedBanner.css'

/**
 * 看板顶部的「今日简报」状态条：已生成时报生成时间，未生成时说明打开日报会补生成。
 *
 * 只读 `list` 判断，绝不调用 `getToday`——后者会触发生成，打开看板不该有副作用。
 * 只有 `list` 明确给出今天这一行时才下结论：读取失败、返回里没有今天，都不说「未生成」，
 * 否则会把一次读取故障说成一份没写的简报。这两种情况什么都不挂。
 *
 * 每份版次（日期 + 语言）的每种状态只提示一次：确认后按 editionKey 记在 localStorage，
 * 刷新或重启不再提示；新的一天或切换语言是一份新版次，会再次提示。
 * 已生成与未生成分开记账：上午关掉「未生成」，下午补生成后仍然会看到「已生成」。
 */
export type DailyBriefingGeneratedBannerText = Readonly<{
  title: string
  /** 含 `{time}` 占位。 */
  generatedAt: string
  /** 今天当前语言尚无版次时的标题。 */
  pendingTitle: string
  /** 解释打开日报会补生成这一版。 */
  pendingHint: string
  dismiss: string
}>

type BannerEdition =
  | Readonly<{ kind: 'generated'; editionKey: string; generatedAt: string }>
  | Readonly<{ kind: 'pending'; editionKey: string }>

/** 版次身份 = 日期 + 语言；也是 localStorage 的记账单位。 */
export function dailyBriefingBannerEditionKey(date: string, locale: DailyBriefingLocale): string {
  return `${date}:${locale}`
}

/** 已生成提示沿用原 key，升级后不会把已经确认过的版次再弹一遍。 */
const generatedStoragePrefix = 'market-intelligence.daily-briefing.generated-banner.v1'
const pendingStoragePrefix = 'market-intelligence.daily-briefing.pending-banner.v1'

const currentInstant = (): Date => new Date()

export function DailyBriefingGeneratedBanner({ locale, text, client = dailyBriefingClient, now = currentInstant }: Readonly<{
  locale: DailyBriefingLocale
  text: DailyBriefingGeneratedBannerText
  /** 只读列表；页面不需要、也不许为这条横幅读取会触发生成的今日版次。 */
  client?: Pick<DailyBriefingClient, 'list'>
  /** 判断「今天」的瞬时；测试注入固定时钟。 */
  now?: () => Date
}>): React.ReactElement | null {
  const timeZone = useShellTimeZone()
  const formatTime = useShellTimeFormat()
  const [edition, setEdition] = useState<BannerEdition | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const today = localDate(timeZone, now())

  useEffect(() => {
    let active = true
    setEdition(null)
    setAcknowledged(false)
    void client.list({ locale, timeZone }).then((result) => {
      if (!active || result.state !== 'available') return
      const row = result.result.editions.find((candidate) =>
        candidate.date === today && candidate.locale === locale)
      const next = row ? editionFor(row, locale) : null
      if (!next) return
      setEdition(next)
      setAcknowledged(isAcknowledged(next.kind, next.editionKey))
    }).catch(() => undefined)
    return () => { active = false }
  }, [client, locale, timeZone, today])

  if (!edition || acknowledged) return null

  const dismiss = (): void => {
    acknowledge(edition.kind, edition.editionKey)
    setAcknowledged(true)
  }

  return <div
    className={`mi-daily-brief-banner${edition.kind === 'pending' ? ' mi-daily-brief-banner--pending' : ''}`}
    data-daily-brief-banner-state={edition.kind}
    data-daily-brief-generated-banner
    role="status"
  >
    {edition.kind === 'generated'
      ? <Check aria-hidden="true" className="mi-daily-brief-banner__icon" size={15} strokeWidth={2.2} />
      : <CalendarClock aria-hidden="true" className="mi-daily-brief-banner__icon" size={15} strokeWidth={2.2} />}
    <div className="mi-daily-brief-banner__copy">
      <span className="mi-daily-brief-banner__title">
        {edition.kind === 'generated' ? text.title : text.pendingTitle}
      </span>
      <span className="mi-daily-brief-banner__time">
        {edition.kind === 'generated'
          ? text.generatedAt.replace('{time}', formatTime(edition.generatedAt))
          : text.pendingHint}
      </span>
    </div>
    <button className="mi-daily-brief-banner__dismiss" type="button" onClick={dismiss}>
      <X aria-hidden="true" size={12} />
      {text.dismiss}
    </button>
  </div>
}

/**
 * 今天这一行只说明两种确定状态：有生成时间，或明确标为缺失。
 * `generated` 却没有时间同样是读不完整，不做提示。
 */
function editionFor(row: DailyBriefingEditionSummary, locale: DailyBriefingLocale): BannerEdition | null {
  const editionKey = dailyBriefingBannerEditionKey(row.date, locale)
  if (row.state === 'generated' && row.generatedAt) return { kind: 'generated', editionKey, generatedAt: row.generatedAt }
  if (row.state === 'missing') return { kind: 'pending', editionKey }
  return null
}

function isAcknowledged(kind: BannerEdition['kind'], editionKey: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(kind, editionKey)) === '1'
  } catch {
    return false
  }
}

function acknowledge(kind: BannerEdition['kind'], editionKey: string): void {
  try {
    window.localStorage.setItem(storageKey(kind, editionKey), '1')
  } catch {
    // 存储被拒绝时仍然关闭本次横幅，只是记不住——不因存储失败把提示留在屏幕上。
  }
}

function storageKey(kind: BannerEdition['kind'], editionKey: string): string {
  return `${kind === 'generated' ? generatedStoragePrefix : pendingStoragePrefix}:${editionKey}`
}

function localDate(timeZone: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(at)
  } catch {
    return at.toISOString().slice(0, 10)
  }
}
