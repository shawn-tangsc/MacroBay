import type { DailyBriefingEditionSummary, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingText } from './dailyBriefingText'

/**
 * 历史轨一行的文字零件：时刻、日期、失败原因。
 *
 * 从 `DailyBriefingHistoryRail.tsx` 挪出来：那个文件已经顶在体积门禁上，而这些是**纯函数**
 * （输入一行、输出一句话），和渲染没有关系。`railClock` 另有两处外部引用，原文件仍转发它。
 */
/**
 * 第一行那个时刻：定时期写「截止 07:00」，**手动期没有截止**，写「08:00 发起」。
 *
 * 手动期借默认期的 07:00 是以前真出过的错：那一行说的是别人的时刻。老记录既没有 periodTime 也没有
 * 排期时刻时返回 `undefined`，界面写「未记录」，不回填。
 */
export function clockOf(edition: DailyBriefingEditionSummary, text: DailyBriefingText, timeZone: string): string | undefined {
  // 手动期：`periodTime` 就是这次发起的那一刻（没有版次时由尝试记录的 started_at 补上）。
  if (edition.periodKind === 'manual') {
    if (edition.periodTime === undefined) return undefined
    return text.history.timeStarted.replace('{time}', railClock(edition.periodTime, timeZone))
  }
  const nominal = edition.periodTime === undefined ? edition.scheduledTime : railClock(edition.periodTime, timeZone)
  if (nominal === undefined) return undefined
  return `${text.history.timeCutoff} ${nominal}`
}


/**
 * 「打开会话」的可访问名里点名是哪一版：日期 + 时刻（没有时刻就只说日期）。
 *
 * 没有它，读屏会连着听到一串「打开会话」而分不清是哪一期的；而按钮自己的文字必须保持简短，
 * 所以详细的那一句只放在名字里。
 */
export function sessionWhen(edition: DailyBriefingEditionSummary, locale: DailyBriefingLocale, timeZone: string): string {
  const date = formatRailDate(edition.date, locale)
  // 与行上那个时刻同一份取值：有版次用它的名义时刻（带时区换算），没版次用排期时刻（已经是 HH:MM）。
  const at = edition.periodTime === undefined ? edition.scheduledTime : railClock(edition.periodTime, timeZone)
  return at === undefined ? date : `${date} ${at}`
}


export function runReasonOf(edition: DailyBriefingEditionSummary): string | undefined {
  return (edition.languages ?? []).find((language) => language.reason !== undefined)?.reason
}


/**
 * 没有正文的那一行，第二行写的是**为什么没有**——空行会被读成"还在加载"。
 *
 * 中断过的、失败过的、从没跑过的不是同一件事：一个还可以再试，一个这次没生成出来，一个是根本没开始。
 */
/** 第二行状态词后面那半句：失败说"这次没生成出来"，从没跑过说"这一期没有生成过"。 */
export function reasonSuffix(edition: DailyBriefingEditionSummary, text: DailyBriefingText, failedRun: boolean, interrupted: boolean): string | null {
  if (interrupted) return null
  return failedRun ? ` ${text.history.railFailedReason}` : ` ${text.history.railNotRun}`
}

export function reasonOf(edition: DailyBriefingEditionSummary, text: DailyBriefingText): string {
  const reason = runReasonOf(edition)
  if (reason === 'run-interrupted') return text.history.runInterrupted
  if (reason === 'run-failed') return text.history.railFailedReason
  // 读者自己的动作：不建行、也不编一句"没跑过"（`02` v2.176）。走到这里说明投影漏了，留空。
  if (reason === 'run-cancelled') return ''
  return text.history.railNotRun
}


/** `HH:mm` in the reader's zone: the row's date is on the line above, the offset is the setting's. */
export function railClock(instant: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(instant))
  } catch {
    return instant.slice(11, 16)
  }
}

export function formatRailDate(date: string, locale: DailyBriefingLocale): string {
  const parsed = Date.parse(`${date}T00:00:00.000Z`)
  if (!Number.isFinite(parsed)) return date
  const value = new Date(parsed)
  const day = new Intl.DateTimeFormat(locale, { month: '2-digit', day: '2-digit', timeZone: 'UTC' }).format(value)
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(value)
  return `${day} ${weekday}`
}

