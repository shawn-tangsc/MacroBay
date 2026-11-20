import { useEffect, useState } from 'react'

import type { EventSourceWritesRead } from '../../../../service/intelligence/macro-calendar/rendering/marketCalendarEventSourceWritesRead'
import { marketCalendarClient } from '../../../shared/ipc/marketCalendarClient'

/**
 * 详情里的「各来源记录」：**只有拿到身份和期次才去读**。
 *
 * 两步缺一不可：
 * - 没有指标身份（讲话、会议、旧源未登记的行）→ 不读，也不显示这一块；
 * - 没有期次 → 不读：读口不带期次会返回这个指标的**所有月份**，那正是我们上一轮发现并修掉的错。
 *
 * 返回 `undefined` 表示「正在读」或「不适用」——两种情况界面都不画块：**空块比没有块更容易被误解**。
 * 读不到时返回读口自己的 `unavailable`，由调用点决定要不要说一句，不在这里编「没有记录」。
 */
export function useEventSourceWrites(
  input: Readonly<{ metricKey: string; scheduledDate: string }> | undefined
): EventSourceWritesRead | undefined {
  const [read, setRead] = useState<EventSourceWritesRead | undefined>(undefined)
  const metricKey = input?.metricKey
  const scheduledDate = input?.scheduledDate
  useEffect(() => {
    if (metricKey === undefined || scheduledDate === undefined) {
      setRead(undefined)
      return undefined
    }
    let current = true
    setRead(undefined)
    void marketCalendarClient.queryEventSourceWrites({ metricKey, scheduledDate })
      .then((answer) => { if (current) setRead(answer) })
      .catch(() => { if (current) setRead({ state: 'unavailable', reasonCode: 'query-unavailable' }) })
    return () => { current = false }
  }, [metricKey, scheduledDate])
  return read
}
