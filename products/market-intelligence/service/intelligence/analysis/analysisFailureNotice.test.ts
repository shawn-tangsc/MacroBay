import { expect, it } from 'vitest'

import {
  ANALYSIS_CHECK_MODEL_ACTION_KEY, ANALYSIS_CHECK_MODEL_SETTINGS_ACTION_KEY,
  ANALYSIS_RETRY_ACTION_KEY, ANALYSIS_TIMELINE_ACTION_KEY
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

it('④ 新闻解读：正文说清是新闻，动作只有重试，不给不存在的「查看时间轴」', () => {
  const news = buildAnalysisFailureRequest({ ...base, kind: 'manual', analysisKind: 'news', triggerKey: 'news.manual' })
  expect(news.rendered!['zh-CN']!.title).toContain('新闻解读')
  expect(news.rendered!['zh-CN']!.body).toContain('新闻解读')
  expect(news.rendered!['zh-CN']!.body).not.toContain('时间轴')
  const labelKeys = news.actions.map(action => action.labelRef && 'key' in action.labelRef ? action.labelRef.key : null)
  // 新闻解读不写时间轴：只有「重试」，没有那条会指向市场时间轴的入口。
  expect(labelKeys).toEqual([ANALYSIS_RETRY_ACTION_KEY])
  // 连接类仍是「检查模型连接」，不给重试。
  const connection = buildAnalysisFailureRequest({
    ...base, kind: 'manual', analysisKind: 'news', triggerKey: 'news.manual',
    failureCode: 'analysis-provider-error', failureDetailCode: 'connect-failed'
  })
  expect(connection.actions.map(action => action.labelRef && 'key' in action.labelRef ? action.labelRef.key : null)).toEqual([ANALYSIS_CHECK_MODEL_ACTION_KEY])
  expect(connection.rendered!['zh-CN']!.body).toContain('检查模型配置或网络后可以重试')
})

it('⑤ 网络没就绪单独一档：不给「检查模型连接」，动作只有重试', () => {
  for (const kind of ['manual', 'automatic'] as const) {
    const request = buildAnalysisFailureRequest({
      ...base, kind, failureCode: 'analysis-provider-error', failureDetailCode: 'network-not-ready'
    })
    const labelKeys = request.actions.map(action => action.labelRef && 'key' in action.labelRef ? action.labelRef.key : null)
    expect(labelKeys, kind).toEqual([ANALYSIS_RETRY_ACTION_KEY])
    expect(labelKeys, kind).not.toContain(ANALYSIS_CHECK_MODEL_ACTION_KEY)
    expect(request.rendered!['zh-CN']!.body).toBe('网络还没就绪，稍后重试。')
    expect(request.rendered!['en-US']!.body).toContain('not ready yet')
  }
  // 同一个粗码、另一条失败原因不能被并成同一条：读者要做的事不一样。
  const network = buildAnalysisFailureRequest({
    ...base, kind: 'automatic', triggerKey: 'market-reaction.15m',
    failureCode: 'analysis-provider-error', failureDetailCode: 'network-not-ready'
  })
  const connection = buildAnalysisFailureRequest({
    ...base, kind: 'automatic', triggerKey: 'market-reaction.15m',
    failureCode: 'analysis-provider-error', failureDetailCode: 'connect-failed'
  })
  expect(network.dedupeVars).not.toEqual(connection.dedupeVars)
})

it('⑥ 供应商返回 4xx：不归为连接类，正文不说「没有连上」', () => {
  // 请求到了服务端并拿到了 401/403：说成「连不上」等于让读者去查一个不存在的问题。
  const request = buildAnalysisFailureRequest({
    ...base, kind: 'manual', failureCode: 'analysis-provider-error', failureDetailCode: 'http-4xx'
  })
  expect(request.rendered!['zh-CN']!.body).toContain('拒绝了这次请求')
  expect(request.rendered!['zh-CN']!.body).not.toContain('没有连上')
  expect(request.rendered!['en-US']!.body).not.toContain('could not be reached')
  expect(request.rendered!['zh-CN']!.reason).not.toContain('网络')
  const labelKeys = request.actions.map(action => action.labelRef && 'key' in action.labelRef ? action.labelRef.key : null)
  expect(labelKeys).toEqual([ANALYSIS_CHECK_MODEL_SETTINGS_ACTION_KEY])
})

it('⑦ 没选出模型单独一档：正文说模型，不给网络指引', () => {
  const request = buildAnalysisFailureRequest({
    ...base, kind: 'manual', failureCode: 'analysis-provider-not-ready', failureDetailCode: 'model-not-selected'
  })
  expect(request.rendered!['zh-CN']!.body).toContain('还没有可用的模型')
  expect(request.rendered!['zh-CN']!.body).not.toContain('网络')
  expect(request.rendered!['zh-CN']!.reason).not.toContain('网络')
  const labelKeys = request.actions.map(action => action.labelRef && 'key' in action.labelRef ? action.labelRef.key : null)
  expect(labelKeys).toEqual([ANALYSIS_CHECK_MODEL_SETTINGS_ACTION_KEY])
})
