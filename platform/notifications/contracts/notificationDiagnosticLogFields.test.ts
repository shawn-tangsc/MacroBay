import { describe, expect, it } from 'vitest'

import type { NotificationDiagnosticsEntry } from './notificationDiagnostics'
import { DIAGNOSTIC_LOG_FIELDS, diagnosticLogFields } from './notificationDiagnosticLogFields'

/**
 * 装配层的诊断适配器**不许再吞字段**（2026-11-08 的线上教训：`reason` 被吞，
 * `notification.submit-failed` / `notification.redeliver-rejected` 两行都没有原因）。
 *
 * 两条判据：
 * - 契约新增一个字段却没加进清单 → **只编译期断言**就红（不靠人记得）；
 * - 一份带原因的条目穿过适配器，原因必须还在。
 */
type MissingFromLogFields = Exclude<
  Exclude<keyof NotificationDiagnosticsEntry, 'code' | 'level'>,
  (typeof DIAGNOSTIC_LOG_FIELDS)[number]
>
// 编译期：漏一个字段 → 这里的类型参数不是 `never` → `typecheck` 红。
function assertEveryFieldIsListed<T extends never>(): void {}
assertEveryFieldIsListed<MissingFromLogFields>()

describe('diagnostic log fields', () => {
  it('passes the reason through instead of dropping it', () => {
    const fields = diagnosticLogFields({
      code: 'submit-failed',
      eventTypeId: 'platform.analysis.recovered',
      producerId: 'market-intelligence.runMarketAnalysis',
      reason: 'TypeError',
      at: '2026-11-08T08:10:05.000Z'
    })
    expect(fields).toEqual({
      eventTypeId: 'platform.analysis.recovered',
      producerId: 'market-intelligence.runMarketAnalysis',
      reason: 'TypeError',
      at: '2026-11-08T08:10:05.000Z'
    })
  })

  it('carries the whole closed set: record id, key, param, step, language and count', () => {
    expect(diagnosticLogFields({
      code: 'copy-unresolved',
      recordId: 'notification-1',
      key: 'notification.event.x.title',
      param: 'taskName',
      step: 'channel',
      language: 'en-US',
      count: 3,
      at: '2026-11-08T00:00:00.000Z'
    })).toEqual({
      recordId: 'notification-1',
      key: 'notification.event.x.title',
      param: 'taskName',
      step: 'channel',
      language: 'en-US',
      count: 3,
      at: '2026-11-08T00:00:00.000Z'
    })
  })

  it('never invents a field that is not in the list', () => {
    const fields = diagnosticLogFields({ code: 'unclaimed-producer', at: '2026-11-08T00:00:00.000Z' })
    expect(Object.keys(fields).sort()).toEqual(['at'])
  })
})
