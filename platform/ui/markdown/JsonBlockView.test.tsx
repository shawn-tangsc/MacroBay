import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { ShellLanguageProvider } from '../shell/ShellLanguageContext'

import ChatMarkdownText, { parseMarkdownBlocks } from './ChatMarkdownText'
import { parseJsonBlock } from './jsonBlock'

const structuredPayload = [
  '{',
  '  "label": "BTC 15m 复核",',
  '  "text": "结构仍偏多，但量能没有跟上。",',
  '  "tone": "watch",',
  '  "watchPoints": ["前高 68.4k", "资金费率"],',
  '  "caveats": ["样本只有一个交易对"]',
  '}'
].join('\n')

function renderZh(text: string): string {
  return renderToStaticMarkup(
    <ShellLanguageProvider language="zh-CN">
      <ChatMarkdownText text={text} />
    </ShellLanguageProvider>
  )
}

function renderEn(text: string): string {
  return renderToStaticMarkup(
    <ShellLanguageProvider language="zh-CN">
      <ChatMarkdownText text={text} language="en-US" />
    </ShellLanguageProvider>
  )
}

describe('structured JSON blocks in chat markdown (PLAT-64)', () => {
  it('recognises a whole-paragraph object or array, and leaves prose alone', () => {
    expect(parseJsonBlock(structuredPayload)).toMatchObject({ kind: 'object' })
    expect(parseJsonBlock('["a", "b", "c"]')).toBeNull() // < 2 行且 < 40 字符 ⇒ 碎片留在正文
    expect(parseJsonBlock('["first-item-of-a-long-array", "second-item", "third"]')).toMatchObject({ kind: 'array' })
    // 句子中间的行内 JSON 不是"整段"：首尾不是大括号，识别层必须不碰它。
    expect(parseJsonBlock('举例：{"a":1} 表示结构化对象，这在正文里应保持原样。')).toBeNull()
    expect(parseJsonBlock('前面有解释文字\n{\n  "a": 1\n}')).toBeNull()
    expect(parseJsonBlock('{ "a": 1, }')).toBeNull() // 解析失败 ⇒ 原样文本
  })

  it('renders a whole-paragraph JSON object as a code block instead of raw braces in prose', () => {
    // 没有 title/summary 这类已知键 ⇒ 不是卡片，走代码块（这是"不认识就按代码块显示"的兜底）。
    const html = renderZh(
      '{ "tone": "watch", "watchPoints": ["前高 68.4k", "资金费率"], "note": "结构偏多但量能没跟上", "score": 42 }'
    )

    expect(html).toContain('<pre')
    expect(html).toContain('<code>')
    expect(html).not.toContain('chat-markdown-json-card')
    // 原始 JSON 只出现在代码块里：正文不再有裸段落，也没有未转义的键。
    expect(html).not.toContain('<p>')
    expect(html).toContain('&quot;watchPoints&quot;')
    expect(html).not.toContain('"watchPoints"')
  })

  it('renders a known card shape as a card, and keeps the unshown fields reachable', () => {
    const html = renderZh(structuredPayload)

    expect(html).toContain('chat-markdown-json-card')
    expect(html).toContain('BTC 15m 复核')
    expect(html).toContain('结构仍偏多，但量能没有跟上。')
    // 卡片隐藏了 tone/watchPoints/caveats ⇒ 必须给原始 JSON 入口，且默认不把 JSON 摊在正文里。
    expect(html).toContain('查看原始 JSON')
    expect(html).not.toContain('watchPoints')
  })

  it('falls back to the code block for a JSON shape it does not recognise', () => {
    const html = renderZh('{"rows":[{"a":1}],"total":3,"generatedAt":"2026-10-14T06:00:00.000Z"}')

    expect(html).toContain('<pre')
    expect(html).not.toContain('chat-markdown-json-card')
    expect(html).toContain('generatedAt')
  })

  it('folds more than twenty lines with an explicit expand control and a folded-count hint', () => {
    const longJson = JSON.stringify(
      { generatedAt: '2026-10-14T06:00:00.000Z', rows: Array.from({ length: 30 }, (_, index) => ({ id: `row-${index}` })) },
      null,
      2
    )
    const html = renderZh(longJson)

    expect(html).toContain('展开')
    expect(html).toMatch(/已折叠 \d+ 行/)
    // 折叠只是收纳：前 20 行仍在代码块里，剩余行数与提示一致。
    expect(html).toContain('&quot;generatedAt&quot;')
    expect(html.split('\n').length).toBeLessThan(longJson.split('\n').length)
  })

  it('takes the fold labels from the explicit language prop (an English UI must not show Chinese)', () => {
    const longJson = JSON.stringify({ rows: Array.from({ length: 30 }, (_, index) => ({ id: `row-${index}` })) }, null, 2)
    const html = renderEn(longJson)

    expect(html).toContain('Expand')
    expect(html).toContain('lines folded')
    expect(html).not.toContain('展开')
  })

  it('does not fold a short JSON block, and keeps it out of the prose paragraph', () => {
    const html = renderZh('{ "label": "净值", "text": "今日 +1.2%（示例文本足够长，超过四十个字符的阈值）" }')

    expect(html).not.toContain('展开')
    expect(html).toContain('chat-markdown-json-card')
  })

  it('keeps inline JSON inside a sentence exactly as written', () => {
    const sentence = '字段样例：{"label":"x"} 只是正文里的例子，不应变成代码块。'
    const html = renderZh(sentence)
    const blocks = parseMarkdownBlocks(sentence)

    expect(blocks).toEqual([{ kind: 'paragraph', text: sentence }])
    expect(html).not.toContain('<pre')
    expect(html).toContain('字段样例：')
  })

  it('keeps fenced code blocks untouched even when they contain JSON', () => {
    const html = renderZh('```json\n{"a":1}\n```')

    expect(html).toContain('<pre class="chat-markdown-code"><code>{&quot;a&quot;:1}</code></pre>')
    expect(html).not.toContain('chat-markdown-json-card')
  })
})
