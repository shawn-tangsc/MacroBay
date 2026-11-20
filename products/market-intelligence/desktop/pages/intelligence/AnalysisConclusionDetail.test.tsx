// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import type { MarketAnalysisTimelineDetail } from '../../shared/ipc/marketAnalysisTimelineClient'
import { AnalysisConclusionDetail } from './AnalysisConclusionDetail'

/**
 * 「生成时是英语」只在一件事成立时出现：**记录里知道生成语言，且与当前界面语言不同**。
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
  it('keeps the note in the icon and puts that icon inside the header, before the title', () => {
    // 用户 2026-11-20：ⓘ 掉到标题下面一行了。判据是 DOM 位置，不是截图。
    const onRegenerate = vi.fn()
    render(detail({ schemaVersion: 2, proseLanguage: 'en-US' }), onRegenerate)
    const header = host.querySelector('header.mi-analysis-conclusion__head')!
    expect(header).not.toBeNull()
    const info = header.querySelector('button[aria-label]') as HTMLButtonElement
    expect(info.getAttribute('aria-label')).toBe('语言说明')
    // ⓘ 必须在 header 里（不是外面那个块级段落），并且是 header 子树里的第一个按钮、排在标题前面。
    // 注意：Popover 规定触发器包在 `span.platform-popover__anchor` 里（浮层定位锚点），所以 DOM 上
    // 它的父元素是那个 span、span 才是 firstElementChild；按字面「parentElement === header」得改
    // 平台 Popover，这里用等价判据。
    expect(info.closest('header.mi-analysis-conclusion__head')).toBe(header)
    expect(header.firstElementChild?.contains(info)).toBe(true)
    expect(header.querySelector('button')).toBe(info)
    const title = header.querySelector('.mi-analysis-timeline__section-label')!
    expect(info.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 标题在窄屏会省略（CSS ellipsis）：全名必须拿得到，否则「AI CON…」就没有出处。
    expect(title.getAttribute('title')).toBe(text.conclusion)
    // 说明句只在浮层里，不进标题行正文；原来那个块级段落也不留空壳。
    const note = text.conclusionLanguageNote.replace('{language}', '英语')
    expect(header.textContent).not.toContain(note)
    expect(host.querySelector('.mi-analysis-conclusion__language')).toBeNull()
    // 「重新生成」仍是这一屏自己的动作，没有被卷进 header。
    const regenerate = [...host.querySelectorAll('button')].find(button => button.textContent === text.regenerateConclusion)!
    expect(header.contains(regenerate)).toBe(false)
    act(() => { regenerate.click() })
    expect(onRegenerate).toHaveBeenCalledTimes(1)
  })

  it('says nothing about language when the record carries none (older summaries), and still offers regenerate', () => {
    // 旧记录没有语言字段：不标注、不猜。但「重新生成」与语言无关，它必须还在——这条动作曾因为
    // 被嵌进语言说明的条件里而一起消失。
    render(detail({ schemaVersion: 1 }), vi.fn())
    expect(host.querySelector('header.mi-analysis-conclusion__head button[aria-label]')).toBeNull()
    expect([...host.querySelectorAll('button')].some(button => button.textContent === text.regenerateConclusion)).toBe(true)
  })

  it('says nothing when the recorded language is the one being read', () => {
    render(detail({ schemaVersion: 2, proseLanguage: 'zh-CN' }), vi.fn())
    expect(host.querySelector('header.mi-analysis-conclusion__head button[aria-label]')).toBeNull()
  })
})
