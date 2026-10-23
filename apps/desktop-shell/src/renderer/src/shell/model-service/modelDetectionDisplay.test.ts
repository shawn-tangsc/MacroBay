import { describe, expect, it } from 'vitest'

import type { ModelDetectionResult } from '@platform/ai/providers/modelDetection/types'

import { platformText } from '../../i18n/platformText'

import {
  detectionStatusText,
  detectionStatusTitle,
  protocolOutcomeSummary,
  protocolRunSummary
} from './modelDetectionDisplay'
import type { ModelDetectionRun } from './modelDetectionController'

/**
 * PLAT-82：检测结果的展示派生（唯一实现）。
 *
 * 这一层决定用户到底"看见什么"：行内 `成功 · 协议 2/2`、title 里的逐协议明细、
 * 弹窗的 `已测 N 个模型，M 项不通`。协议结论复用联通性请求时必须标出来源。
 */
const labels = platformText['en-US'].models
const zh = platformText['zh-CN'].models

function result(overrides: Partial<ModelDetectionResult> = {}): ModelDetectionResult {
  return { runId: 'run-1', modelId: 'm-1', status: 'ok', ...overrides }
}

function run(overrides: Partial<ModelDetectionRun> = {}): ModelDetectionRun {
  return {
    runId: 'run-1',
    providerId: 'acme',
    modes: ['connectivity', 'protocol'],
    results: {},
    total: 3,
    finished: true,
    stopped: false,
    ...overrides
  }
}

describe('PLAT-82 行内协议摘要', () => {
  it('counts passed/total protocol probes', () => {
    const summary = protocolOutcomeSummary(result({
      protocols: [
        { protocol: 'chat-completions', ok: true, reused: true },
        { protocol: 'messages', ok: false, reasonCode: 'endpoint_unsupported' }
      ]
    }))

    expect(summary).toMatchObject({ passed: 1, total: 2 })
    expect(summary?.failed.map((entry) => entry.protocol)).toEqual(['messages'])
  })

  it('has no summary when the run did not probe protocols', () => {
    expect(protocolOutcomeSummary(result())).toBeUndefined()
    expect(protocolOutcomeSummary(result({ protocols: [] }))).toBeUndefined()
  })

  it('appends the protocol count to the inline status', () => {
    expect(detectionStatusText(labels, 'ok', result({
      protocols: [
        { protocol: 'chat-completions', ok: true },
        { protocol: 'messages', ok: true }
      ]
    }))).toBe('OK · Protocols 2/2')

    expect(detectionStatusText(labels, 'ok', result({
      protocols: [
        { protocol: 'chat-completions', ok: true },
        { protocol: 'messages', ok: false, reasonCode: 'endpoint_unsupported' }
      ]
    }))).toBe('OK · Protocols 1/2')
  })

  it('keeps the plain status when protocol mode was not selected', () => {
    expect(detectionStatusText(labels, 'ok', result())).toBe('OK')
    // 协议模式被整项跳过（无已配置端点 / 非聊天模型）时也不加：那一行已经有「跳过：原因」。
    expect(detectionStatusText(labels, 'skipped', result({ protocolSkipReason: 'protocol_not_configured' })))
      .toBe(labels.detectionSkippedWithReason(labels.probeSkipProtocolNotConfigured))
  })

  it('writes the per-protocol detail into the title', () => {
    const title = detectionStatusTitle(labels, 'ok', result({
      protocols: [
        { protocol: 'chat-completions', ok: true, reused: true },
        { protocol: 'messages', ok: false, reasonCode: 'endpoint_unsupported' }
      ]
    }))

    expect(title.startsWith('OK · Protocols 1/2 · ')).toBe(true)
    // 复用的结论要说清来源，失败项带原因。
    expect(title).toContain('OpenAI Chat ✓（reused connectivity）')
    expect(title).toContain(`Anthropic Messages ✗ ${labels.probeReasonEndpointUnsupported}`)
  })

  it('keeps the Chinese wording for the inline summary', () => {
    expect(zh.detectionProtocolCount(2, 2)).toBe('协议 2/2')
    expect(zh.detectionProtocolReusedBadge).toBe('复用联通性')
    expect(detectionStatusText(zh, 'ok', result({
      protocols: [{ protocol: 'chat-completions', ok: true, reused: true }]
    }))).toBe('成功 · 协议 1/1')
  })
})

describe('PLAT-82 弹窗协议汇总', () => {
  it('counts only models that actually produced protocol outcomes', () => {
    const summary = protocolRunSummary(run({
      results: {
        'm-1': result({
          modelId: 'm-1',
          protocols: [
            { protocol: 'chat-completions', ok: true, reused: true },
            { protocol: 'messages', ok: false, reasonCode: 'endpoint_unsupported' }
          ]
        }),
        'm-2': result({ modelId: 'm-2', protocols: [{ protocol: 'chat-completions', ok: true }] }),
        // 非聊天模型：协议项被跳过，不参与"已测 N 个模型"。
        'm-3': result({ modelId: 'm-3', status: 'skipped', protocolSkipReason: 'not_chat_model' })
      }
    }))

    expect(summary).toEqual({ models: 2, failed: 1 })
  })

  it('reports all-passed and ignores cancelled probes', () => {
    expect(protocolRunSummary(run({
      results: {
        'm-1': result({ modelId: 'm-1', protocols: [{ protocol: 'chat-completions', ok: true, reused: true }] })
      }
    }))).toEqual({ models: 1, failed: 0 })

    expect(protocolRunSummary(run({
      results: {
        'm-1': result({ modelId: 'm-1', protocols: [{ protocol: 'messages', ok: false, reasonCode: 'cancelled' }] })
      }
    }))).toEqual({ models: 1, failed: 0 })
  })

  it('stays empty when the run did not select protocol mode', () => {
    expect(protocolRunSummary(run({
      modes: ['connectivity'],
      results: { 'm-1': result({ modelId: 'm-1', protocols: [{ protocol: 'chat-completions', ok: true }] }) }
    }))).toBeUndefined()
    expect(protocolRunSummary(undefined)).toBeUndefined()
    expect(protocolRunSummary(run())).toBeUndefined()
  })
})
