import { describe, expect, it } from 'vitest'

import { productText } from '../../../shared/i18n/productText'
import { signalAnalysisSentence, type SignalAnalysisCopyLookup, type SignalAnalysisCopyPart } from './signalAnalysisSentence'

const states: Record<string, string> = {
  published: '分析已出',
  skipped: '这次没有分析',
  failed: '分析了但没成',
  stopped: '这次运行提前结束了'
}
const stopped: Record<string, string> = {
  'run-cancelled': '这次运行被取消了',
  'run-superseded': '这次已被更新的一次取代，不用等',
  'run-unrecognized': '状态读不出来',
  'run-expired': '这次分析跑过，但已经超过保存期，看不到结果'
}
const skippedReasons: Record<string, string> = { 'signal-cooldown-active': '同一规则刚分析过，这次不重复' }
const failedReasons: Record<string, string> = { 'analysis-provider-error': '模型服务出错了' }

const lookup: SignalAnalysisCopyLookup = (query: SignalAnalysisCopyPart) => {
  if (query.part === 'state') return states[query.code] ?? ''
  if (query.part === 'stoppedReason') return stopped[query.code] ?? ''
  if (query.part === 'skippedReason') return skippedReasons[query.code] ?? ''
  if (query.part === 'failedReason') return failedReasons[query.code] ?? ''
  if (query.part === 'offByReader') return '你关闭了自动分析，这条信号不会自动分析'
  if (query.part === 'separator') return '：'
  return '原因没记录'
}

const view = (analysisState: string, analysisReason?: string) =>
  ({ analysisOffByReader: false, analysisState, ...(analysisReason ? { analysisReason } : {}) }) as never

describe('the analysis-progress sentence', () => {
  it('says each state once, and only the three refusing states carry a reason', () => {
    // 「还在等」不显示：连一句话都不产出，不是换个说法。
    expect(signalAnalysisSentence(view('not-triggered'), lookup)).toBeUndefined()
    expect(signalAnalysisSentence(view('queued'), lookup)).toBeUndefined()
    expect(signalAnalysisSentence(view('published'), lookup)).toBe('分析已出')
    expect(signalAnalysisSentence(view('skipped', 'signal-cooldown-active'), lookup)).toBe('这次没有分析：同一规则刚分析过，这次不重复')
    expect(signalAnalysisSentence(view('failed', 'analysis-provider-error'), lookup)).toBe('分析了但没成：模型服务出错了')
    expect(signalAnalysisSentence(view('stopped', 'run-cancelled'), lookup)).toBe('这次运行被取消了')
    expect(signalAnalysisSentence(view('stopped', 'run-superseded'), lookup)).toBe('这次已被更新的一次取代，不用等')
  })

  it('blames the reader’s own switch, not the system, when auto-analysis is off', () => {
    const off = { analysisOffByReader: true, analysisState: 'skipped', analysisReason: 'signal-cooldown-active' } as never
    expect(signalAnalysisSentence(off, lookup)).toBe('你关闭了自动分析，这条信号不会自动分析')
    // 关掉之后即使还有运行状态，也不该说成「这次没分析（因为冷却）」——责任指错了。
    const offQueued = { analysisOffByReader: true, analysisState: 'queued' } as never
    expect(signalAnalysisSentence(offQueued, lookup)).toBe('你关闭了自动分析，这条信号不会自动分析')
  })

  it('says a run whose record expired ran, instead of leaving the reader waiting', () => {
    expect(signalAnalysisSentence(view('stopped', 'run-expired'), lookup)).toBe('这次分析跑过，但已经超过保存期，看不到结果')
  })

  it('keeps the two code tables apart instead of merging them', () => {
    // 失败的码喂给账本表、账本码喂给失败表：两边都查不到，都落兜底，不许串表。
    expect(signalAnalysisSentence(view('failed', 'signal-cooldown-active'), lookup)).toBe('分析了但没成：原因没记录')
    expect(signalAnalysisSentence(view('skipped', 'analysis-provider-error'), lookup)).toBe('这次没有分析：原因没记录')
  })

  it('never prints a code and never prints an empty reason', () => {
    const unknown = signalAnalysisSentence(view('failed', 'analysis-something-new'), lookup)
    expect(unknown).toBe('分析了但没成：原因没记录')
    expect(unknown).not.toContain('analysis-')
  })
})

describe('the copy table itself', () => {
  const zh = productText['zh-CN'].pages.intelligence.portal.dashboard.signalAnalysis
  const en = productText['en-US'].pages.intelligence.portal.dashboard.signalAnalysis

  it('has no stopped status line: that branch renders its reason, never an outer sentence', () => {
    // 写了却走不到的文案比没有更坏——下一个人会照着它改外层句，改完什么都不会变。
    expect(zh.states).not.toHaveProperty('stopped')
    expect(en.states).not.toHaveProperty('stopped')
  })

  it('ends no status or reason sentence with a full stop', () => {
    for (const table of [zh, en]) {
      const sentences = [
        ...Object.values(table.states),
        ...Object.values(table.stoppedReasons),
        table.offByReader,
        table.reasonUnknown
      ]
      for (const sentence of sentences) expect(sentence).not.toMatch(/[。.]$/)
    }
  })
})

describe('the path the cards actually read', () => {
  /** 卡片走的是点分键路径；键挂错一层时句子会解析成空串，**整句不上屏**，而从前的用例看不出来。 */
  const read = (language: 'zh-CN' | 'en-US', key: string): unknown =>
    key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], productText[language])

  it('finds every sentence under the dashboard namespace', () => {
    const base = 'pages.intelligence.portal.dashboard.signalAnalysis'
    for (const language of ['zh-CN', 'en-US'] as const) {
      for (const key of [`${base}.states.published`, `${base}.states.skipped`, `${base}.states.failed`,
        `${base}.stoppedReasons.run-expired`, `${base}.offByReader`, `${base}.reasonUnknown`, `${base}.separator`]) {
        expect(read(language, key), `${language} ${key}`).toBeTruthy()
      }
    }
  })
})
