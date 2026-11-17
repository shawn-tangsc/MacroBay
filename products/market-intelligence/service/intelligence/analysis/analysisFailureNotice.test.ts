import { expect, it } from 'vitest'

import {
  ANALYSIS_CHECK_MODEL_ACTION_KEY, ANALYSIS_RETRY_ACTION_KEY, ANALYSIS_TIMELINE_ACTION_KEY
} from '../../../contracts/notificationEventKeys'
import { buildAnalysisFailureRequest, shouldReportAutomaticFailure } from './analysisFailureNotice'

const eventId = 'market-intelligence.analysis.failed'
const base = {
  runId: 'mi-ar-1', eventGroupId: 'mi-eg-1', triggerKey: 'manual.initial',
  failureCode: 'analysis-timeout', failureDetailCode: null, occurredAt: '2026-11-18T01:00:00.000Z'
} as const

it('① 手动失败：一条通知，恰好一个「重试」主动作', () => {
  const request = buildAnalysisFailureRequest({ ...base, kind: 'manual' })
  expect(request.eventTypeId).toBe(eventId)
  expect(request.dedupeVars).toEqual({ builder: 'template', vars: { identity: 'manual:mi-ar-1' } })
  const labelKeys = request.actions.map(action => action.labelRef && 'key' in action.labelRef ? action.labelRef.key : null)
  expect(labelKeys.filter(key => key === ANALYSIS_RETRY_ACTION_KEY)).toHaveLength(1)
  // 次入口是「查看时间轴」，不是第二个重试。
  expect(labelKeys).toContain(ANALYSIS_TIMELINE_ACTION_KEY)
  expect(request.actions.filter(action => action.kind === 'custom')).toHaveLength(1)
})

it('② 自动失败：同码同窗口一条键，跨窗口换键；不同码绝不合并', () => {
  const automatic = { ...base, kind: 'automatic' as const, triggerKey: 'market-reaction.15m' }
  const first = buildAnalysisFailureRequest(automatic)
  const sameWindow = buildAnalysisFailureRequest({ ...automatic, runId: 'mi-ar-2', occurredAt: '2026-11-18T01:20:00.000Z' })
  const nextWindow = buildAnalysisFailureRequest({ ...automatic, runId: 'mi-ar-3', occurredAt: '2026-11-18T01:31:00.000Z' })
  const otherCode = buildAnalysisFailureRequest({ ...automatic, runId: 'mi-ar-4', failureCode: 'analysis-invalid-json' })
  expect(sameWindow.dedupeVars).toEqual(first.dedupeVars)
  expect(nextWindow.dedupeVars).not.toEqual(first.dedupeVars)
  expect(otherCode.dedupeVars).not.toEqual(first.dedupeVars)
  // 自动失败不给重试：主动作只有「查看时间轴」。
  const labelKeys = first.actions.map(action => action.labelRef && 'key' in action.labelRef ? action.labelRef.key : null)
  expect(labelKeys).toEqual([ANALYSIS_TIMELINE_ACTION_KEY])
})

it('③ 连接类：主动作是「检查模型连接」，正文走连接那一句，不出现「解读失败/读不懂」', () => {
  const request = buildAnalysisFailureRequest({ ...base, kind: 'manual', failureCode: 'analysis-provider-error', failureDetailCode: 'connect-failed' })
  expect(request.actions).toHaveLength(1)
  const [action] = request.actions
  expect(action!.labelRef && 'key' in action!.labelRef ? action!.labelRef.key : null).toBe(ANALYSIS_CHECK_MODEL_ACTION_KEY)
  expect(action!.kind).toBe('open')
  expect(request.rendered!['zh-CN']!.body).toContain('这次没有连上模型服务')
  expect(request.rendered!['zh-CN']!.body).not.toContain('解读失败')
  expect(request.rendered!['en-US']!.body).toContain('could not be reached')
  // 新加一个 failureCode 不会自动落进「重试」分支：非连接类才有重试。
  const other = buildAnalysisFailureRequest({ ...base, kind: 'manual', failureCode: 'analysis-invalid-output-schema' })
  expect(other.rendered!['zh-CN']!.body).not.toContain('没有连上')
})

it('自动链路级：连续 3 次失败，或最近一次成功后 2 小时零成功才报', () => {
  const at = '2026-11-18T10:00:00.000Z'
  const failed = (minutesAgo: number) => ({ status: 'failed', completedAt: new Date(Date.parse(at) - minutesAgo * 60_000).toISOString(), queuedAt: at })
  expect(shouldReportAutomaticFailure({ occurredAt: at, history: [failed(1), failed(20)] })).toBe(true)
  expect(shouldReportAutomaticFailure({ occurredAt: at, history: [failed(1)] })).toBe(false)
  const success = { status: 'succeeded', completedAt: new Date(Date.parse(at) - 30 * 60_000).toISOString(), queuedAt: at }
  expect(shouldReportAutomaticFailure({ occurredAt: at, history: [failed(1), success] })).toBe(false)
  const oldSuccess = { status: 'succeeded', completedAt: new Date(Date.parse(at) - 121 * 60_000).toISOString(), queuedAt: at }
  expect(shouldReportAutomaticFailure({ occurredAt: at, history: [failed(1), oldSuccess] })).toBe(true)
})
