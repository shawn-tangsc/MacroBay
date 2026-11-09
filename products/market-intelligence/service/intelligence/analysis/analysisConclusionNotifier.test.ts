import { describe, expect, it, vi } from 'vitest'

import type { NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'
import { createAnalysisConclusionNotifier } from './analysisConclusionNotifier'
import { MARKET_INTELLIGENCE_NOTIFICATION_APPROVALS } from '../../../contracts/notificationApprovals'

/**
 * 出站层：判定层给的结论翻成一次提交。三条看结果——**同向收窄到只进中心**（手机腿不排）、
 * **反向不收窄**（按批准表全档，含 `channel`）、**去重分量只有触发键与截止时刻**。配额只影响收窄，不影响提交。
 *
 * 收窄字段是平台提交契约自己的键（`NotificationApprovedLevel[]`），这里不做任何类型断言；
 * 「`['center']` → 记录 `channels` 只有 center、`delivery.push` 为空」由平台的
 * `notificationNarrowedSurface.test.ts` 用这同一个事件钉住——两边合起来才是「手机不响」。
 */
const approvedLevels = MARKET_INTELLIGENCE_NOTIFICATION_APPROVALS['market-intelligence.analysis.conclusion']!.approvedDisruptionLevels

const notice = (overrides: Partial<Parameters<ReturnType<typeof createAnalysisConclusionNotifier>>[0]> = {}) => ({
  runId: 'mi-ar-1',
  triggerKey: 'signal.open-interest.oi-liquidation-proxy',
  cutoff: '2026-11-08T03:00:00.000Z',
  summary: '多头被清，价格跌到位后买盘回来了。',
  conclusionDirection: 'bullish' as const,
  citedFactIds: ['mi-fact-oi', 'mi-fact-price'],
  triggerDirection: 'bearish' as const,
  triggerFactIds: ['mi-fact-oi'],
  citedCount: 2,
  occurredAt: '2026-11-08T03:10:00.000Z',
  ...overrides
})

const narrowOf = (request: NotificationSubmitRequest) => request.narrowedDisruptionLevels

describe('the analysis conclusion submit', () => {
  it('submits once with the trigger key and the cutoff, and no run id in the vars', async () => {
    const submit = vi.fn(async (_request: NotificationSubmitRequest) => ({ kind: 'accepted' as const, recordId: 'n-1', levels: [], suppressedLevels: [] }))
    const send = createAnalysisConclusionNotifier({ submit, now: () => '2026-11-08T03:10:00.000Z', timeZone: () => 'Asia/Shanghai' })
    await send(notice())
    expect(submit).toHaveBeenCalledTimes(1)
    const request = submit.mock.calls[0]![0] as NotificationSubmitRequest
    expect(request.dedupeVars).toEqual({ builder: 'template', vars: { triggerKey: 'signal.open-interest.oi-liquidation-proxy', cutoff: '2026-11-08T03:00:00.000Z' } })
    expect(JSON.stringify(request.dedupeVars)).not.toContain('mi-ar-1')
    expect(request.eventTypeId).toBe('market-intelligence.analysis.conclusion')
  })

  it('does not narrow when the conclusion goes the other way', async () => {
    // 反向（信号说跌、结论说涨）**不传**收窄字段 = 按批准表全档，也就是手机那一档照常排上。
    const submit = vi.fn(async (_request: NotificationSubmitRequest) => ({ kind: 'accepted' as const, recordId: 'n-1', levels: [], suppressedLevels: [] }))
    const send = createAnalysisConclusionNotifier({ submit, now: () => '2026-11-08T03:10:00.000Z', timeZone: () => 'Asia/Shanghai' })
    await send(notice())
    expect(narrowOf(submit.mock.calls[0]![0] as NotificationSubmitRequest)).toBeUndefined()
    expect(approvedLevels).toContain('channel')
  })

  it('narrows to the centre when the conclusion agrees with the signal', async () => {
    const submit = vi.fn(async (_request: NotificationSubmitRequest) => ({ kind: 'accepted' as const, recordId: 'n-1', levels: [], suppressedLevels: [] }))
    const send = createAnalysisConclusionNotifier({ submit, now: () => '2026-11-08T03:10:00.000Z', timeZone: () => 'Asia/Shanghai' })
    await send(notice({ conclusionDirection: 'bearish', citedFactIds: ['mi-fact-oi'] }))
    const narrowed = narrowOf(submit.mock.calls[0]![0] as NotificationSubmitRequest)
    expect(narrowed).toEqual(['center'])
    // 批准表里本来有 `channel`（手机）；收窄值里没有它，所以这一条只落中心。
    expect(approvedLevels).toContain('channel')
    expect(narrowed).not.toContain('channel')
  })

  it('narrows once the day or module cap is reached, but still submits', async () => {
    const submit = vi.fn(async (_request: NotificationSubmitRequest) => ({ kind: 'accepted' as const, recordId: 'n-1', levels: [], suppressedLevels: [] }))
    const now = () => '2026-11-08T03:10:00.000Z'
    const send = createAnalysisConclusionNotifier({ submit, now, timeZone: () => 'Asia/Shanghai' })
    // 同一触发键第二条：收窄（只进中心），不是不发。
    await send(notice())
    await send(notice({ runId: 'mi-ar-2', conclusionDirection: 'bearish', citedFactIds: ['mi-fact-oi'] }))
    expect(submit).toHaveBeenCalledTimes(2)
    // 模块上限 4：第 5 条起也收窄，但依旧提交。
    for (let index = 0; index < 3; index += 1) await send(notice({ runId: `mi-ar-${index + 3}`, triggerKey: `signal.open-interest.rule-${index}` }))
    await send(notice({ runId: 'mi-ar-9', triggerKey: 'signal.open-interest.rule-9' }))
    expect(submit).toHaveBeenCalledTimes(6)
    expect(narrowOf(submit.mock.calls[5]![0] as NotificationSubmitRequest)).toEqual(['center'])
  })

  it('carries one sentence in both languages and lets the body carry the evidence count only when pushing', async () => {
    const submit = vi.fn(async (_request: NotificationSubmitRequest) => ({ kind: 'accepted' as const, recordId: 'n-1', levels: [], suppressedLevels: [] }))
    const send = createAnalysisConclusionNotifier({ submit, now: () => '2026-11-08T03:10:00.000Z', timeZone: () => 'Asia/Shanghai' })
    await send(notice())
    const rendered = (submit.mock.calls[0]![0] as NotificationSubmitRequest).rendered!
    expect(rendered['zh-CN']?.body).toBe(rendered['en-US']?.body)
    expect(rendered['zh-CN']?.body).toContain('证据 2 条')
    expect(rendered['zh-CN']?.title).toBe('分析结论')
    expect(rendered['en-US']?.title).toBe('Analysis conclusion')
  })

  it('never lets a failed submission break the run', async () => {
    const submit = vi.fn(async (_request: NotificationSubmitRequest) => { throw new Error('channel down') })
    const send = createAnalysisConclusionNotifier({ submit, now: () => '2026-11-08T03:10:00.000Z', timeZone: () => 'Asia/Shanghai' })
    await expect(send(notice())).resolves.toBeUndefined()
  })
})
