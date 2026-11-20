import { useEffect, useState } from 'react'

import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { MappingRulesDialog, type MappingRulesText } from './MappingRulesDialog'
import type { MappingRulesRead } from '../../../service/intelligence/macro-calendar/rendering/marketCalendarMappingRulesRead'
import type { CodeTableRead } from '../../../service/intelligence/macro-calendar/rendering/marketCalendarCodeTableRead'
import type { CalendarEventListRead } from '../../../service/intelligence/macro-calendar/rendering/marketCalendarEventListRead'
import { marketCalendarClient } from '../../shared/ipc/marketCalendarClient'

/**
 * 弹框的取数壳：打开时读**三件事**——码表（整表）、未映射的指标、事件清单，各读一次、各成一态。
 *
 * 为什么分三次读：它们回答的是三个问题（「我们有哪些码」/「哪些指标没落进标准表」/
 * 「库里有哪些事件」），合成一个读口会让任意一边读失败把另外两边也拖成「读不到」。
 *
 * 与「读不到」的边界：`unavailable` 是独立一态，**空数组只表示「没有匹配」**——两件事不许合并，
 * 否则「读不到」会被画成「一个都没有」。
 */
export function MappingRulesPanel({ open, onClose, text }: Readonly<{
  open: boolean
  onClose: () => void
  text: MappingRulesText
}>): React.ReactElement {
  const [view, setView] = useState<MappingRulesRead | undefined>(undefined)
  const [codes, setCodes] = useState<CodeTableRead | undefined>(undefined)
  const [events, setEvents] = useState<CalendarEventListRead | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)
  /**
   * **当前界面语言传下去**（用户 2026-11-21：英文界面下国家列还是中文）：
   * IPC 与读口都按 `locale` 取国家名——英文给两位代码、全名在 `countryNameFull`，中文给中文名。
   */
  const shellLanguage = useShellLanguage()
  // 读口的契约是 `zh` / `en` 两档（shell 那边是 `zh-CN` / `en-US`）：在**一个地方**换算，别让
  // 两种写法散到调用点去（散开就会出现某处忘了换、某处传错档）。
  const locale: 'zh' | 'en' = shellLanguage === 'en-US' ? 'en' : 'zh'

  useEffect(() => {
    if (!open) return undefined
    let current = true
    setView(undefined)
    setCodes(undefined)
    setEvents(undefined)
    void marketCalendarClient.queryMappingRules({ locale })
      .then((answer) => { if (current) setView(answer) })
      .catch(() => { if (current) setView({ state: 'unavailable', reasonCode: 'query-unavailable' }) })
    void marketCalendarClient.queryCodeTable({ locale })
      .then((answer) => { if (current) setCodes(answer) })
      .catch(() => { if (current) setCodes({ state: 'unavailable', reasonCode: 'query-unavailable' }) })
    void marketCalendarClient.queryEventList()
      .then((answer) => { if (current) setEvents(answer) })
      .catch(() => { if (current) setEvents({ state: 'unavailable', reasonCode: 'query-unavailable' }) })
    return () => { current = false }
  }, [open, attempt, locale])

  return <MappingRulesDialog open={open} onClose={onClose} text={text} view={view} codes={codes} events={events}
    onRetry={() => setAttempt((value) => value + 1)} />
}
