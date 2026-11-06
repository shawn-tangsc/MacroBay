import { getNotificationRuntime } from '@platform/notifications'

import type { MacroCalendarSqlite } from '../macroCalendarSqlite'
import type { MacroCalendarEvidenceArchive } from '../macroCalendarEvidenceArchive'
import type { createStoredManualCalendar } from './zeroXRouterCalendarManualRuntime'
import { createStoredManualCalendar as create } from './zeroXRouterCalendarManualRuntime'

type StoredCalendarDependencies = Parameters<typeof createStoredManualCalendar>[0]

/**
 * 组合根：把「日历采集」和「这条腿的通知出口」接在一起。
 *
 * 单独成文件不是为了好看：`bootstrap.ts` 是只减不增的基线文件，而这条接线必须有一处明确的
 * 归属——通知跟着采集走，不跟着分析走。放在这里，下一眼就能看到它挂在哪一侧：**采集完成就
 * 提交**，读者开没开分析不参与判断。
 */
export function composeStoredManualCalendar(
  deps: Omit<StoredCalendarDependencies, 'submitNotification'> & Readonly<{
    storage: MacroCalendarSqlite
    archive: MacroCalendarEvidenceArchive
  }>
): ReturnType<typeof createStoredManualCalendar> {
  return create({
    ...deps,
    // 平台单例，等用的时候再取：装配顺序上产品服务先于通知运行时。
    submitNotification: (request) => getNotificationRuntime().submit(request)
  })
}
