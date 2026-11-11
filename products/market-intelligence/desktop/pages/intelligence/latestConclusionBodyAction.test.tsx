// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { LatestAnalysisConclusionCard } from './LatestAnalysisConclusionCard'

const workspaceText = { ...productText['zh-CN'].pages.intelligence.portal.data, openDetail: '查看完整结论', openTimeline: '分析时间轴' }
const text = productText['zh-CN'].pages.intelligence.portal.analysisWorkspace as never
const css = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/marketAnalysisWorkspace.css'), 'utf8')

const entry = {
  id: 'e1', eventGroupId: 'g1', analysisRunId: 'r1', kind: 'analysis' as const, status: 'published' as const,
  occurredAt: '2026-11-11T05:00:00.000Z', summaryRef: 's1', safeTitle: '标题', safeExcerpt: null, version: 1
}
const detail = { summary: { verdict: '结论正文', directions: [] } } as never

let root: Root | undefined
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.replaceChildren() })

function render(input: { pending?: string; withDetail?: boolean; onOpenDetail?: (value: unknown) => void; onOpenTimeline?: () => void; ensureDetail?: (value: unknown) => void }) {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const timeline = {
    state: { entries: [entry] },
    details: input.withDetail === false ? {} : { e1: detail },
    detailState: { e1: input.pending ?? (input.withDetail === false ? 'loading' : 'ready') },
    ensureDetail: input.ensureDetail ?? vi.fn(),
    loading: false
  }
  const element = createElement(LatestAnalysisConclusionCard, {
    text,
    workspaceText,
    timeline: timeline as never,
    onOpenDetail: (input.onOpenDetail ?? vi.fn()) as never,
    ...(input.onOpenTimeline === undefined ? {} : { onOpenTimeline: input.onOpenTimeline }),
    openTimelineLabel: workspaceText.openTimeline ?? '分析时间轴',
    enableAnalysisLabel: '启用分析',
    analysisOffHint: '分析关着'
  } as never)
  act(() => { root!.render(element) })
  return { container, timeline }
}

describe('结论正文即入口（div role=button）', () => {
  it('is a div with role button, not a button element, and names itself with openDetail', () => {
    const { container } = render({})
    expect(container.querySelector('button.mi-analysis-conclusion-card__body')).toBeNull()
    const body = container.querySelector<HTMLElement>('.mi-analysis-conclusion-card__body[role="button"]')!
    expect(body).not.toBeNull()
    expect(body.getAttribute('aria-label')).toBe('查看完整结论')
    expect(body.tabIndex).toBe(0)
    // 块内没有任何可聚焦元素（头部在块外）。
    expect(body.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')).toHaveLength(0)
  })

  it('opens the drawer on click and treats Enter / Space the same', () => {
    const onOpenDetail = vi.fn()
    const { container } = render({ onOpenDetail })
    const body = container.querySelector<HTMLElement>('.mi-analysis-conclusion-card__body[role="button"]')!
    act(() => body.click())
    expect(onOpenDetail).toHaveBeenCalledTimes(1)
    act(() => { body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(onOpenDetail).toHaveBeenCalledTimes(2)
    act(() => { body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })) })
    expect(onOpenDetail).toHaveBeenCalledTimes(3)
  })

  it('keeps the header outside the clickable block: the timeline button never opens the detail', () => {
    const onOpenDetail = vi.fn()
    const onOpenTimeline = vi.fn()
    const { container } = render({ onOpenDetail, onOpenTimeline })
    const headerButton = [...container.querySelectorAll('button')].find((button) => button.textContent === (workspaceText.openTimeline ?? '分析时间轴'))!
    act(() => headerButton.click())
    expect(onOpenTimeline).toHaveBeenCalledTimes(1)
    expect(onOpenDetail).not.toHaveBeenCalled()
  })

  it('reads first when the detail is not ready, then opens when it arrives', () => {
    const onOpenDetail = vi.fn()
    const ensureDetail = vi.fn()
    const first = render({ withDetail: false, onOpenDetail, ensureDetail })
    const loadingBody = first.container.querySelector<HTMLElement>('.mi-analysis-conclusion-card__body[role="button"]')!
    act(() => loadingBody.click())
    expect(ensureDetail).toHaveBeenCalled()
    expect(onOpenDetail).not.toHaveBeenCalled()
  })

  it('paints the focus ring only for keyboard, always with accent', () => {
    // happy-dom 不解析样式表：用样式原文钉两条规则（键盘才显示、鼠标点完不留圈）。
    expect(css).toMatch(/\.mi-analysis-conclusion-card__body--action:focus-visible \{[^}]*outline: 2px solid var\(--accent\)/u)
    expect(css).toMatch(/\.mi-analysis-conclusion-card__body--action:focus:not\(:focus-visible\) \{ outline: none; \}/u)
    // 悬停复用同一档 token 混合，不新造颜色。
    expect(css).toMatch(/\.mi-analysis-conclusion-card__body--action:hover \{[^}]*color-mix\(in srgb, var\(--surface-soft\) 45%, transparent\)/u)
  })
})
