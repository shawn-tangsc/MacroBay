// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import type { MarketAnalysisTimelineDetail } from '../../shared/ipc/marketAnalysisTimelineClient'
import { AnalysisConclusionDetail } from './AnalysisConclusionDetail'

/**
 * 「这条结论是按英文写的」只在一件事成立时出现：**记录里知道生成语言，且与当前界面语言不同**。
 *
 * 三条边界一起钉住：
 * - 旧记录（v1，没有字段）→ 不标注、不崩；
 * - 语言一致 → 不标注、不加按钮（正常情况不多一行噪音）；
 * - 语言不同 → 一句事实 + 「重新生成」，点它走宿主给的那一个动作。
 */
const zh = productText['zh-CN'].pages.intelligence.portal
const text = { ...zh.analysisTimeline, ...zh.analysisWorkspace, readableLocale: 'zh-CN' as const }
const asOf = '2026-10-04T00:00:00.000Z'

function detail(summary: Record<string, unknown>): MarketAnalysisTimelineDetail {
  return {
    run: { id: 'mi-ar-1', eventGroupId: 'mi-eg-1', analysisPhase: 'initial', status: 'succeeded', asOf, dataCutoff: asOf, evidenceCount: 1, change: null },
    summary: {
      id: 'mi-as-1', version: 1, evidenceCount: 1, dataCaveats: [], createdAt: asOf,
      knownFacts: [], transmissionHypotheses: [], marketReaction: [], supportingEvidence: [], counterEvidence: [], nextCatalysts: [],
      conclusion: {
        direction: 'bearish', summary: '偏空。', change: 'ETF 净流出。', causalChain: '资金流出 → 承压。',
        conditions: ['持续流出。'], macro: null, evidenceStrength: null, dataGaps: []
      },
      ...summary
    },
    predictions: []
  } as unknown as MarketAnalysisTimelineDetail
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(input: MarketAnalysisTimelineDetail, onRegenerate?: () => void): void {
  act(() => root.render(<AnalysisConclusionDetail detail={input} text={text} {...(onRegenerate ? { onRegenerate } : {})} />))
}

describe('the conclusion language note', () => {
  it('keeps the language note in the icon, not in the body, and offers regenerate', () => {
    // 正文说明句门禁：说明句只许进 ⓘ。行内只剩「重新生成」，那句话在 hover/点击展开的浮层里。
    const onRegenerate = vi.fn()
    render(detail({ schemaVersion: 2, proseLanguage: 'en-US' }), onRegenerate)
    const row = host.querySelector('.mi-analysis-conclusion__language')!
    expect(row.textContent).not.toContain('这条结论是按英语写的。')
    // ⓘ 的读屏名是短名，不是整句说明。
    const info = row.querySelector('button[aria-label]') as HTMLButtonElement
    expect(info.getAttribute('aria-label')).toBe('语言说明')
    // 「重新生成」是这一屏自己的动作，不在那条语言说明里（曾经误嵌在里面：没有语言说明时整个
    // 动作都不渲染，市场分析组因此白丢一个入口）。
    expect(row.textContent).not.toContain(text.regenerateConclusion)
    const regenerate = [...host.querySelectorAll('button')].find(button => button.textContent === text.regenerateConclusion)!
    act(() => { regenerate.click() })
    expect(onRegenerate).toHaveBeenCalledTimes(1)
  })

  it('says nothing about language when the record carries none (older summaries), and still offers regenerate', () => {
    // 旧记录没有语言字段：不标注、不猜。但「重新生成」与语言无关，它必须还在——这条动作曾因为
    // 被嵌进语言说明的条件里而一起消失。
    render(detail({ schemaVersion: 1 }), vi.fn())
    expect(host.querySelector('.mi-analysis-conclusion__language')).toBeNull()
    expect([...host.querySelectorAll('button')].some(button => button.textContent === text.regenerateConclusion)).toBe(true)
  })

  it('says nothing when the recorded language is the one being read', () => {
    render(detail({ schemaVersion: 2, proseLanguage: 'zh-CN' }), vi.fn())
    expect(host.querySelector('.mi-analysis-conclusion__language')).toBeNull()
  })
})
