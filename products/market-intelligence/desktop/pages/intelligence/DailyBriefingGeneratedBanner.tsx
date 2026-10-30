import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'

import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import { dailyBriefingClient, type DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'

import './dailyBriefingGeneratedBanner.css'

/**
 * 「今日简报已生成」横幅：看板顶部的一条状态条，不是窗口级通知。
 *
 * 只读 `list` 判断，绝不调用 `getToday`——后者会触发生成，打开看板不该有副作用。
 * 每份版次（日期 + 语言）只提示一次：确认后按 editionKey 记在 localStorage，刷新或重启不再提示；
 * 新的一天或切换语言是一份新版次，会再次提示。
 */
export type DailyBriefingGeneratedBannerText = Readonly<{
  title: string
  /** 含 `{time}` 占位。 */
  generatedAt: string
  dismiss: string
}>

type GeneratedEdition = Readonly<{ editionKey: string; generatedAt: string }>

/** 版次身份 = 日期 + 语言；也是 localStorage 的记账单位。 */
export function dailyBriefingBannerEditionKey(date: string, locale: DailyBriefingLocale): string {
  return `${date}:${locale}`
}

const storagePrefix = 'market-intelligence.daily-briefing.generated-banner.v1'

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
  const [edition, setEdition] = useState<GeneratedEdition | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const today = localDate(timeZone, now())

  useEffect(() => {
    let active = true
    setEdition(null)
    setAcknowledged(false)
    void client.list({ locale, timeZone }).then((result) => {
      if (!active || result.state !== 'available') return
      const row = result.result.editions.find((candidate) =>
        candidate.date === today &&
        candidate.locale === locale &&
        candidate.state === 'generated' &&
        Boolean(candidate.generatedAt))
      if (!row?.generatedAt) return
      setEdition({ editionKey: dailyBriefingBannerEditionKey(row.date, locale), generatedAt: row.generatedAt })
      setAcknowledged(isAcknowledged(row.date, locale))
    }).catch(() => undefined)
    return () => { active = false }
  }, [client, locale, timeZone, today])

  if (!edition || acknowledged) return null

  const dismiss = (): void => {
    acknowledge(edition.editionKey)
    setAcknowledged(true)
  }

  return <div className="mi-daily-brief-banner" data-daily-brief-generated-banner role="status">
    <Check aria-hidden="true" className="mi-daily-brief-banner__icon" size={15} strokeWidth={2.2} />
    <div className="mi-daily-brief-banner__copy">
      <span className="mi-daily-brief-banner__title">{text.title}</span>
      <span className="mi-daily-brief-banner__time">
        {text.generatedAt.replace('{time}', formatTime(edition.generatedAt))}
      </span>
    </div>
    <button className="mi-daily-brief-banner__dismiss" type="button" onClick={dismiss}>
      <X aria-hidden="true" size={12} />
      {text.dismiss}
    </button>
  </div>
}

function isAcknowledged(date: string, locale: DailyBriefingLocale): boolean {
  try {
    return window.localStorage.getItem(storageKey(dailyBriefingBannerEditionKey(date, locale))) === '1'
  } catch {
    return false
  }
}

function acknowledge(editionKey: string): void {
  try {
    window.localStorage.setItem(storageKey(editionKey), '1')
  } catch {
    // 存储被拒绝时仍然关闭本次横幅，只是记不住——不因存储失败把提示留在屏幕上。
  }
}

function storageKey(editionKey: string): string {
  return `${storagePrefix}:${editionKey}`
}

function localDate(timeZone: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(at)
  } catch {
    return at.toISOString().slice(0, 10)
  }
}
