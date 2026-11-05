import { instantForWallClock } from '@platform/time/timeZoneClock'

/**
 * 这一天的生成时刻过去了没有。
 *
 * 只回答一件事：按读者时区算，`date` 那天的 `time` 是否已经过去。用来决定空态说什么——
 * 没到点只能说「计划 {time} 生成」，过了点才可以说「这一期没有生成」（`02` v2.129 G6）。
 * 时刻读不懂时返回 `undefined`：既不断言"还没到"，也不断言"已经过了"。
 */
export function briefingCutoffPassed(input: Readonly<{
  date: string
  time: string
  timeZone: string
  now: Date
}>): boolean | undefined {
  const [year, month, day] = input.date.split('-').map(Number)
  const [hour, minute] = input.time.split(':').map(Number)
  if ([year, month, day, hour].some((value) => value === undefined || !Number.isFinite(value))) return undefined
  const cutoff = instantForWallClock({
    timeZone: input.timeZone,
    year: year!,
    month: month!,
    day: day!,
    hour: hour!,
    ...(minute === undefined || !Number.isFinite(minute) ? {} : { minute })
  })
  return cutoff === null ? undefined : input.now.getTime() >= cutoff.getTime()
}
