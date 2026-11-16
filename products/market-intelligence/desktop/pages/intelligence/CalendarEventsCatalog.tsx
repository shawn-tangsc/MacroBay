import { useEffect, useState } from 'react'

import { MappingRulesDialog, type MappingRulesText } from './MappingRulesDialog'
import type { MappingRulesRead } from '../../../service/intelligence/macro-calendar/rendering/marketCalendarMappingRulesRead'
import { marketCalendarClient } from '../../shared/ipc/marketCalendarClient'

/**
 * 映射规则弹框的取数壳：打开时读一次（**全量**，数据量很小，不做游标）。
 *
 * 与「读不到」的边界：`unavailable` 是独立一态，**空数组只表示「没有匹配」**——两件事不许合并，
 * 否则「读不到」会被画成「一条规则都没有」。
 */
export function CalendarEventsCatalog({ open, onClose, text }: Readonly<{
  open: boolean
  onClose: () => void
  text: MappingRulesText
}>): React.ReactElement {
  const [view, setView] = useState<MappingRulesRead | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!open) return undefined
    let current = true
    setView(undefined)
    void marketCalendarClient.queryMappingRules()
      .then((answer) => { if (current) setView(answer) })
      .catch(() => { if (current) setView({ state: 'unavailable', reasonCode: 'query-unavailable' }) })
    return () => { current = false }
  }, [open, attempt])

  return <MappingRulesDialog open={open} onClose={onClose} text={text} view={view}
    onRetry={() => setAttempt((value) => value + 1)} />
}
