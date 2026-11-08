// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

import { productText } from '../../shared/i18n/productText'
import { AnalysisTimelineDrawer } from './AnalysisTimelineDrawer'
import type { UseMarketAnalysisTimelineResult } from './useMarketAnalysisTimeline'
import { channelFactsOf, sendActionOffered } from './useAnalysisConclusionSendReadiness'

/**
 * 「发送到频道」摆不摆，以及它交出去的配置事实。
 *
 * 判据（定稿）：**0 条可用通道 → 按钮整个不渲染**（不是禁用）；**≥2 条 → 按钮在、点了才拒绝**；
 * 读不到也先不摆。这里把平台读口换成桩，桌面上只验证「按钮在不在」。
 */
const text = productText['zh-CN'].pages.intelligence.portal.analysisTimeline

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
  // 抽屉是 portal 到 body 的：不整块清掉，上一个用例的按钮会留在下一个用例里。
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

const timelineWithOneConclusion = (): UseMarketAnalysisTimelineResult => ({
  state: {
    entries: [{
      id: 'mi-tl-1',
      eventGroupId: 'mi-eg-1',
      analysisRunId: 'mi-ar-1',
      kind: 'analysis',
      status: 'published',
      occurredAt: '2026-11-08T12:00:00.000Z',
      summaryRef: 'mi-as-1',
      safeTitle: '标题',
      safeExcerpt: '结论',
      version: 1,
      triggerStatus: null,
      groupType: null,
      groupSubject: null
    }],
    loading: false,
    failed: false,
    nextCursor: null
  }
}) as unknown as UseMarketAnalysisTimelineResult

const renderDrawer = async (readiness: unknown): Promise<HTMLDivElement> => {
  vi.stubGlobal('platform', {
    products: {
      invoke: vi.fn(async (productId: string, method: string) => {
        if (productId !== 'market-intelligence') return undefined
        // 只有那一问有内容；面板自己还会读设置，给它一个「读不到」的空形状就行。
        return method === 'intelligence.getAnalysisConclusionSendChannel' ? readiness : undefined
      })
    },
    productEvents: { subscribe: () => () => undefined }
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(ShellTimeZoneProvider, null, createElement(AnalysisTimelineDrawer, {
      open: true,
      text,
      timeline: timelineWithOneConclusion(),
      onOpenChange: () => undefined,
      onClose: () => undefined
    })))
  })
  // 可用性是打开抽屉时读的：等那一拍落到 DOM 上。
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  return host
}

// 抽屉 portal 到 body：查 body，不查挂载点。
const sendButton = (): Element | null => document.body.querySelector('.mi-analysis-send__button')

describe('whether the send action is offered', () => {
  it('renders nothing when no channel is ready', async () => {
    await renderDrawer({ state: 'unavailable', enabledChannelCount: 0, multiple: false })
    expect(sendButton()).toBeNull()
    // ⓘ 是给这个动作解释用的，按钮不在就一起收起来。
    expect(document.body.querySelector('.mi-analysis-timeline-drawer')).not.toBeNull()
  })

  it('keeps the action when several channels are ready, so the click can explain', async () => {
    await renderDrawer({ state: 'unavailable', enabledChannelCount: 2, multiple: true })
    expect(sendButton()).not.toBeNull()
  })

  it('offers the action when exactly one channel is ready', async () => {
    await renderDrawer({ state: 'ready' })
    expect(sendButton()).not.toBeNull()
  })

  it('does not offer an action it could not check', async () => {
    await renderDrawer({ state: 'nonsense' })
    expect(sendButton()).toBeNull()
  })
})

describe('the rule on its own', () => {
  it('offers nothing for zero channels, the action for several, and carries the count for guidance', () => {
    expect(sendActionOffered({ state: 'unavailable', enabledChannelCount: 0, multiple: false })).toBe(false)
    expect(sendActionOffered({ state: 'unavailable', enabledChannelCount: 2, multiple: true })).toBe(true)
    expect(sendActionOffered({ state: 'unknown' })).toBe(false)
    expect(channelFactsOf({ state: 'unavailable', enabledChannelCount: 2, multiple: true }))
      .toEqual({ enabledChannelCount: 2, multiple: true })
    // 有一条可用时不需要「指路」的事实：成功句的通道名只认回执。
    expect(channelFactsOf({ state: 'ready' })).toBeUndefined()
  })
})
