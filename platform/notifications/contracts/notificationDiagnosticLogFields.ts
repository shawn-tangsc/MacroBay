import type { NotificationDiagnosticsEntry } from './notificationDiagnostics'

/**
 * 诊断条目里**允许进日志**的字段：都是闭集码、id、条数与时刻。
 *
 * 不含句子、凭据、路径、`maskedFields`、workspace、chatIds——这条边界由「只列这些字段」来保证，
 * 而不是靠调用方记得别多写。
 *
 * 为什么要有这份显式清单（2026-11-08 的教训）：装配层的适配器原来只透传 `count/eventTypeId/
 * producerId/at`，把 `reason` 吞掉了——于是 `notification.submit-failed` 与
 * `notification.redeliver-rejected` 在日志里都**没有原因**，线上一个「日报没推到」查了三层才定案。
 * 一份手写白名单还会继续吞下一个字段，所以 `notificationDiagnosticLogFields.test.ts` 里有一条
 * 编译期断言：契约新增字段却没加进这张表，`typecheck` 就红。
 */
export const DIAGNOSTIC_LOG_FIELDS = [
  'eventTypeId',
  'producerId',
  'recordId',
  'key',
  'param',
  'reason',
  'step',
  'language',
  'count',
  'states',
  'at'
] as const satisfies readonly Exclude<keyof NotificationDiagnosticsEntry, 'code' | 'level'>[]

export type DiagnosticLogFields = Record<string, unknown>

/** 一条诊断 → 日志的三件（档位、事件名、字段）。档位规则**不在这里**：它由调用方一处定义。 */
export function diagnosticLogFields(entry: NotificationDiagnosticsEntry): DiagnosticLogFields {
  const fields: DiagnosticLogFields = {}
  for (const key of DIAGNOSTIC_LOG_FIELDS) {
    const value = entry[key]
    if (value !== undefined) fields[key] = value
  }
  return fields
}
