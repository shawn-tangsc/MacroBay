import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { AnalysisDirectionsBlock, type AnalysisDirectionsText } from './AnalysisDirectionsBlock'

const text: AnalysisDirectionsText = {
  title: '操作方向建议',
  horizons: { short: '短期（0-24 小时）', medium: '中期（1-7 天）', long: '长期（1-4 周）' },
  unknownHorizon: '其他周期',
  confidence: { label: '置信度', low: '低', medium: '中', high: '高' }
}

const directions = [
  { horizon: 'short', direction: '偏多', rationale: '资金流转正。', confidence: 'medium' },
  { horizon: 'medium', direction: '震荡', rationale: '缺少方向性资金。', confidence: 'low' },
  { horizon: 'long', direction: '暂不判断', rationale: '长期证据不足。', confidence: 'low' }
]

describe('analysis directions block', () => {
  it('renders one row per horizon, in the order the model gave', () => {
    const html = renderToStaticMarkup(<AnalysisDirectionsBlock directions={directions} text={text} />)
    expect(html).toContain('操作方向建议')
    expect(html.indexOf('短期（0-24 小时）')).toBeLessThan(html.indexOf('中期（1-7 天）'))
    expect(html.indexOf('中期（1-7 天）')).toBeLessThan(html.indexOf('长期（1-4 周）'))
    expect(html).toContain('资金流转正。')
    expect(html).toContain('置信度中')
  })

  it('colours only a term from the controlled vocabulary, and prints the rest plainly', () => {
    const html = renderToStaticMarkup(<AnalysisDirectionsBlock
      directions={[...directions, { horizon: 'week-2', direction: '看多', rationale: '未知术语。', confidence: 'high' }]} text={text} />)
    // A known term gets its semantic token; an unknown one must not be coloured by keyword luck.
    expect(html).toContain('data-direction="bullish"')
    expect(html).toContain('data-direction="none"')
    // A horizon this build does not know still renders rather than disappearing.
    expect(html).toContain('其他周期')
    expect(html).toContain('看多')
  })

  it('shows the direction in the reader language while the stored term stays canonical', () => {
    const html = renderToStaticMarkup(
      <ShellLanguageProvider language="en-US">
        <AnalysisDirectionsBlock directions={directions} text={text} />
      </ShellLanguageProvider>
    )

    expect(html).toContain('data-direction="bullish"')
    expect(html).toContain('Bullish')
    expect(html).toContain('Range-bound')
    expect(html).not.toContain('偏多')
  })

  it('colours a language-neutral direction key and renders it in the reader language', () => {
    const html = renderToStaticMarkup(
      <ShellLanguageProvider language="zh-CN">
        <AnalysisDirectionsBlock
          directions={[{ horizon: 'short', direction: 'bearish', rationale: '收益率上行。', confidence: 'medium' }]}
          text={text} />
      </ShellLanguageProvider>
    )

    expect(html).toContain('data-direction="bearish"')
    expect(html).toContain('偏空')
    expect(html).not.toContain('bearish</span>')
  })

  it('wears the same direction pill the conclusion uses, not its own type', () => {
    const html = renderToStaticMarkup(<AnalysisDirectionsBlock directions={directions} text={text} />)
    expect(html).toContain('mi-analysis-conclusion__direction')
  })

  it('drops a whole low-confidence row on the card, and never the label alone', () => {
    const card = renderToStaticMarkup(<AnalysisDirectionsBlock directions={directions} text={text} hideLowConfidenceRows />)
    // The rows the model rated low are gone entirely — hiding only their label still read as advice.
    expect(card).not.toContain('置信度低')
    expect(card).not.toContain('缺少方向性资金。')
    expect(card).not.toContain('长期证据不足。')
    expect(card).toContain('资金流转正。')
    expect(card).toContain('置信度中')
    // The drawer is the full record: every row and every label stays.
    const drawer = renderToStaticMarkup(<AnalysisDirectionsBlock directions={directions} text={text} />)
    expect(drawer).toContain('置信度低')
    expect(drawer).toContain('长期证据不足。')
  })

  it('renders nothing at all when every row is low-confidence', () => {
    const low = directions.map(direction => ({ ...direction, confidence: 'low' }))
    expect(renderToStaticMarkup(<AnalysisDirectionsBlock directions={low} text={text} hideLowConfidenceRows />)).toBe('')
  })

  it('renders nothing when the summary predates the field', () => {
    expect(renderToStaticMarkup(<AnalysisDirectionsBlock directions={[]} text={text} />)).toBe('')
  })
})
