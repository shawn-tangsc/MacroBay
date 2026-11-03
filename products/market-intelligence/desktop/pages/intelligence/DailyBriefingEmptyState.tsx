import { StateView } from '@platform/ui/components/state'
import { formatShellTimeZoneLabel } from '@platform/ui/time/shellTimeFormat'

import type { DailyBriefingEditionSummary } from '../../../contracts/dailyBriefing'
import { resolveBriefingStateReason, type DailyBriefingText } from './dailyBriefingText'

/**
 * Today's edition is not readable: nothing was ever generated, today has not run yet, or the read
 * itself failed. Each branch carries a literal reason key, so the resolver guard can tell which
 * sentence the reader will see; a computed key is invisible to it.
 */
export function DailyBriefingEmptyState({ editions, todayDate, timeZone, lastGeneratedAt, formatTime, text, onGenerate }: Readonly<{
  editions: readonly DailyBriefingEditionSummary[]
  todayDate: string
  timeZone: string
  lastGeneratedAt?: string
  formatTime: (value: string, precision?: 'minute' | 'second') => string
  text: DailyBriefingText
  onGenerate: () => void
}>): React.ReactElement {
  const resolve = (key: string, params?: Readonly<Record<string, string>>): string => resolveBriefingStateReason(text, key, params)
  const scheduledTime = editions.find((edition) => edition.scheduledTime !== undefined)?.scheduledTime
  const todayMissing = editions.some((edition) => edition.date === todayDate && edition.state === 'missing')
  const action = { labelKey: 'ui.state.action.create' as const, onSelect: onGenerate }

  if (editions.every((edition) => edition.state === 'missing')) {
    return scheduledTime
      ? <StateView state="empty" reasonCode="never-created" size="lg" action={action}
        productReason={{ key: 'mi.dailyBriefing.noBriefAt', params: { time: scheduledTime, zone: formatShellTimeZoneLabel(timeZone) }, resolve }} />
      : <StateView state="empty" reasonCode="never-created" size="lg" action={action}
        productReason={{ key: 'mi.dailyBriefing.noBrief', resolve }} />
  }
  if (todayMissing) {
    return <StateView state="empty" reasonCode="never-created" size="lg" action={action}
      productReason={{ key: 'mi.dailyBriefing.todayNotRun', resolve }} />
  }
  if (lastGeneratedAt) {
    return <StateView state="error" reasonCode="unreadable" size="lg" action={{ labelKey: 'ui.state.action.retry', onSelect: onGenerate }}
      productReason={{ key: 'mi.dailyBriefing.unreadableSince', params: { moment: formatTime(lastGeneratedAt, 'minute') }, resolve }} />
  }
  return <StateView state="error" reasonCode="unreadable" size="lg" action={{ labelKey: 'ui.state.action.retry', onSelect: onGenerate }}
    productReason={{ key: 'mi.dailyBriefing.unreadable', resolve }} />
}
