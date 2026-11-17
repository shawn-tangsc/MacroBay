import { useEffect, useState } from 'react'

import { MappingRulesDialog, type MappingRulesText } from './MappingRulesDialog'
import type { MappingRulesRead } from '../../../service/intelligence/macro-calendar/rendering/marketCalendarMappingRulesRead'
import type { CodeTableRead } from '../../../service/intelligence/macro-calendar/rendering/marketCalendarCodeTableRead'
import { marketCalendarClient } from '../../shared/ipc/marketCalendarClient'

/**
 * 弹框的取数壳：打开时读**两件事**——码表（整表 244 行）与未映射段，各读一次、各成一态。
 *
 * 为什么分两次读：它们回答的是两个问题（「我们有哪些码」vs「哪些 id 还认不出」），
 * 合成一个读口会让任意一边读失败把另一边也拖成「读不到」。
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
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!open) return undefined
    let current = true
    setView(undefined)
    setCodes(undefined)
    void marketCalendarClient.queryMappingRules()
      .then((answer) => { if (current) setView(answer) })
      .catch(() => { if (current) setView({ state: 'unavailable', reasonCode: 'query-unavailable' }) })
    void marketCalendarClient.queryCodeTable()
      .then((answer) => { if (current) setCodes(answer) })
      .catch(() => { if (current) setCodes({ state: 'unavailable', reasonCode: 'query-unavailable' }) })
    return () => { current = false }
  }, [open, attempt])

  return <MappingRulesDialog open={open} onClose={onClose} text={text} view={view} codes={codes}
    onRetry={() => setAttempt((value) => value + 1)} />
}
