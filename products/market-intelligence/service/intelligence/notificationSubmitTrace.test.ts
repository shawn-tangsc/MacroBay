import { describe, expect, it } from 'vitest'

import type { NotificationDiagnosticsEntry, NotificationRuntimeSettings } from '@platform/notifications/contracts/notificationContracts'
import { createNotificationEventCatalog } from '@platform/notifications/contracts/notificationEventCatalog'
import { createNotificationRuntime, type NotificationStorage } from '@platform/notifications/runtime/notificationRuntime'

import { notifyAnalysisQuota } from './analysis/analysisQuotaNotifier'
import { buildEtfOutflowSignal } from './signals/etfOutflowSignal'
import { notifyEtfOutflowSignals } from './signals/etfOutflowNotifier'
import { notifyManualAnalysisFailure } from './analysis/analysisManualFailureNotifier'
import { notifySourceIssueForSource } from './application/sourceIssueNotifier'
import { notifyDailyBriefing } from './daily-briefing/dailyBriefingNotifier'

/**
 * 六处 `catch {}` 的收口证明（第 10 条同类问题的第二次，2026-11-08）。
 *
 * 这几处**故意不改**：通知不是事实来源，提交通知失败不能把已经落库的行情/日报/采集结果判成失败。
 * 那条取舍成立的前提是「失败事后查得到」。运行时现在每笔提交留一行（`submit-failed` / 被拒的拒绝码），
 * 所以这里要证明的是两件事一起成立：**入口的返回值不变**，且**提交次数 == 留痕条数**。
 *
 * 夹具用「读盘就抛」的真运行时：这样每一笔提交都走 `catch {}` 那一支——正是要证明的那条路。
 *
 * **覆盖范围是 5/6，这是有意为之，不是漏项**：六处里五处有「从入口到留痕」的端到端夹具；第六处
 * （`openInterestSignalNotifier`）的**提交侧**由同一运行时漏斗覆盖——它的提交异常从工厂冒到外层
 * `catch {}`，走的是同一个 `traceSubmitFailure`，再造一份 `state:'available'` 的 OI 历史只是把同一条
 * 断言重复一遍；它的**读失败**那一半另有 `MI_SIGNAL_READ_FAILED` 与其夹具覆盖。两半都盖住了。
 */
const settings: NotificationRuntimeSettings = {
  desktopEnabled: true,
  toastEnabled: false,
  popupEnabled: false,
  push: { channelId: null },
  retentionDays: 30,
  defaultSnoozeMinutes: 60
}
const clock = { now: () => new Date('2026-11-07T00:00:00.000Z'), timeZone: () => 'UTC' }
const NOW = '2026-11-07T00:00:00.000Z'

const failedRun = {
  runId: 'mi-ar-manual-1',
  failureCode: 'analysis-provider-error',
  failureDetailCode: 'upstream-aborted',
  occurredAt: NOW
}

function brokenRuntime() {
  const entries: NotificationDiagnosticsEntry[] = []
  // 读失败 = 每一笔提交都在 `load()` 抛出去，落到各入口的 `catch {}` 上。
  const storage: NotificationStorage = {
    read: async () => {
      throw new Error('notification store is down')
    },
    write: async () => undefined
  }
  const runtime = createNotificationRuntime({
    storage,
    // 批准值随声明走（b2）：这个夹具本来就没有批准行（空目录就够了），所以只去掉参数。
    catalog: createNotificationEventCatalog({ sources: [] }),
    diagnostics: (entry) => entries.push(entry),
    getSettings: async () => settings,
    clock
  })
  return { runtime, entries }
}

const OPEN_OUTLETS = { panel: true, notification: true } as const

/** 一条真信号（走产品自己的信号构造器），这样提交通道也走产品自己的入口。 */
function outflowSignal(asset: 'btc' | 'eth') {
  const asOf = '2026-09-01T12:00:00.000Z'
  const rows = [10, -40_000_000, -50_000_000, -60_000_000].map((netFlowUsd, index) => ({
    tradingDate: `2026-08-${String(25 + index).padStart(2, '0')}`,
    netFlowUsd,
    observedAt: `2026-08-${String(25 + index).padStart(2, '0')}T00:00:00.000Z`
  }))
  const signal = buildEtfOutflowSignal({ asset, rows, asOf })
  if (signal === undefined) throw new Error('expected an available outflow signal')
  return signal
}

describe('S37④ the swallow sites return as before and every submission leaves exactly one line', () => {
  it('quota notice: resolves null, one submit-failed line', async () => {
    const { runtime, entries } = brokenRuntime()
    await expect(
      notifyAnalysisQuota((request) => runtime.submit(request), { used: 48, limit: 48, occurredAt: NOW })
    ).resolves.toBeNull()
    expect(entries.map((entry) => entry.code)).toEqual(['submit-failed'])
    expect(entries[0]).toMatchObject({ level: 'error', eventTypeId: 'platform.analysis.quota-exhausted' })
  })

  it('manual failure notice: resolves without throwing, one submit-failed line', async () => {
    const { runtime, entries } = brokenRuntime()
    await expect(
      notifyManualAnalysisFailure((request) => runtime.submit(request), failedRun)
    ).resolves.toBeUndefined()
    expect(entries.map((entry) => entry.code)).toEqual(['submit-failed'])
  })

  it('daily briefing notice: resolves null, one submit-failed line', async () => {
    const { runtime, entries } = brokenRuntime()
    await expect(
      notifyDailyBriefing(
        (request) => runtime.submit(request),
        { kind: 'failed', variant: 'not-generated', date: '2026-11-07', periodId: 'default' },
        NOW
      )
    ).resolves.toBeNull()
    expect(entries.map((entry) => entry.code)).toEqual(['submit-failed'])
  })

  it('ETF outflow: two signals are two submissions and two lines, and the refresh still finishes', async () => {
    const { runtime, entries } = brokenRuntime()
    await expect(
      notifyEtfOutflowSignals((request) => runtime.submit(request), [outflowSignal('btc'), outflowSignal('eth')], OPEN_OUTLETS)
    ).resolves.toBeUndefined()
    // 条数等于提交次数：两条信号 → 两条，不多一条（双记）也不少一条（漏记）。
    expect(entries.map((entry) => entry.code)).toEqual(['submit-failed', 'submit-failed'])
  })

  it('source issue notice: the collector-facing wrapper still swallows, one submit-failed line', async () => {
    const { runtime, entries } = brokenRuntime()
    await expect(
      notifySourceIssueForSource({
        notifier: async () => {
          await runtime.submit({
            eventTypeId: 'market-intelligence.source.consecutive-failed',
            dedupeVars: { builder: 'template', vars: { sourceId: 'sec-rss' } },
            actions: [],
            occurredAt: NOW
          })
          return null
        },
        sourceId: 'sec-rss',
        health: { consecutiveFailures: 3 }
      })
    ).resolves.toBeUndefined()
    expect(entries.map((entry) => entry.code)).toEqual(['submit-failed'])
  })
})
