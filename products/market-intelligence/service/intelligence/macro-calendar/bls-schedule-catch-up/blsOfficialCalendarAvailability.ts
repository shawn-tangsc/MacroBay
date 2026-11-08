/**
 * BLS 官方日历的可用性判定（用户 2026-11-08 拍板：取不到，就停掉自动同步）。
 *
 * **为什么停**：`www.bls.gov` 与 `api.bls.gov` 在本机所在网络被 CDN 边缘直接拒绝——HTTP 403、
 * `errors.edgesuite.net` 拒绝页；直连、IPv6、配置里的代理出口三种走法结果相同，浏览器 UA 也一样。
 * 2026-11-08 这一天 8 次自动同步全部失败，官方修订表最后一次成功写入是 2026-10-22T07:29:41.000Z。
 * 取证记录：`fixtures/officialMacroCalendarProvenance.ts:18-19`（2026-08-03 那次就是
 * `status: 403 / unavailableReason: 'official-endpoint-returned-403'`）。
 *
 * 这不是「忘了注册」，是**判定为不可达**才停的。恢复时只改这一个常量：把 `state` 改成
 * `'available'` 并把 `blsScheduleAndValuesScheduler.ts` 里那两行排期放回去；手动入口
 * （`macroCalendarWriteActions.ts`）与源状态会跟着恢复，不需要再改第二处。
 *
 * 三种说法必须分开，不能混：
 * - 「自动同步已停止」= 现在的状态（本文件 `automaticSync`）；
 * - 「暂时读不到」= 一次请求读不到（手动入口被拦时的返回）；
 * - 「没有数据」= 确实没有这条事实（**本案不适用**：BLS 的事务确实存在，只是拿不到）。
 */
export type BlsOfficialCalendarAvailability =
  | Readonly<{
    state: 'available'
    automaticSync: 'scheduled'
  }>
  | Readonly<{
    state: 'unavailable'
    /** 既有原因码，取自取证记录，不新造一个。 */
    reasonCode: 'official-endpoint-returned-403'
    /** 自动同步：已停止——不是「未启用」，也不是「失败重试中」。 */
    automaticSync: 'stopped'
    /** 库里最后一次成功写入 BLS 修订的时刻（实测 `mi_macro_calendar_revisions`）。 */
    lastSuccessfulSyncAt: string
    /** 拍板日期。 */
    decidedAt: string
  }>

export const blsOfficialCalendarAvailability: BlsOfficialCalendarAvailability = Object.freeze({
  state: 'unavailable',
  reasonCode: 'official-endpoint-returned-403',
  automaticSync: 'stopped',
  lastSuccessfulSyncAt: '2026-10-22T07:29:41.000Z',
  decidedAt: '2026-11-08'
})

/** 自动同步与手动入口共用这一个判据：一条路停，另一条路也不该再发请求。 */
export function isBlsOfficialCalendarUnavailable(): boolean {
  return blsOfficialCalendarAvailability.state === 'unavailable'
}
