import { NEWS_SENTIMENT_EXTRACTION_VERSION, NEWS_SENTIMENT_LIMITS } from '../schema/newsSentiment'

export const NEWS_BODY_MIN_CHARS = 200
export { NEWS_SENTIMENT_EXTRACTION_VERSION }

export type ExtractedNewsBody = {
  text: string
  chars: number
  state: 'available' | 'too-short'
  extractionVersion: string
}

type ContainerRule =
  | { kind: 'div-class'; token: string }
  | { kind: 'tag'; tag: string }

/**
 * 每源的主内容容器。选择器来自 2026-10-24 的真实页面（设计 154 §6.1）：
 * - SEC: `field--name-body`（`.gov` 横幅与页脚都在容器外）
 * - CoinDesk: `document-body`（导航与 byline 在容器外）
 * - OKX: `<article>`
 * 选择器失效时回退「全页 p/li 过滤」，并靠抽取版本记录口径。
 */
const CONTAINERS: Readonly<Record<string, ContainerRule>> = {
  'sec-rss': { kind: 'div-class', token: 'field--name-body' },
  'coindesk-rss': { kind: 'div-class', token: 'document-body' },
  'okx-latest-announcements': { kind: 'tag', tag: 'article' }
}

const CHROME_RE =
  /^(official websites use \.gov|secure \.gov websites|share this article|copy link|make preferred|\d+ min read|advertisement|subscribe|sign up|related|latest crypto news|skip to main content|disclosure\s*&|coindesk is an award-winning|bullish owns and invests|may receive bullish equity-based compensation|editorial policies|this article is for informational purposes|follow us on)/i

/** 纯函数：HTML → 正文文本。不依赖 DOM，不引第三方正文库。 */
export function extractNewsBody(input: { sourceId: string; html: string; maxChars?: number }): ExtractedNewsBody {
  const maxChars = input.maxChars ?? NEWS_SENTIMENT_LIMITS.bodyChars
  const container = selectContainer(input.html, CONTAINERS[input.sourceId])
  const text = paragraphsToText(container ?? input.html, maxChars)
  return {
    text,
    chars: text.length,
    state: text.length >= NEWS_BODY_MIN_CHARS ? 'available' : 'too-short',
    extractionVersion: NEWS_SENTIMENT_EXTRACTION_VERSION
  }
}

function selectContainer(html: string, rule: ContainerRule | undefined): string | undefined {
  if (!rule) return undefined
  if (rule.kind === 'tag') return extractTag(html, rule.tag)
  return extractDivsByClass(html, rule.token)
}

/**
 * CoinDesk splits one article across several sibling `document-body` blocks (a summary block plus
 * the sections between embeds), so taking the first match returns only a teaser. Collect every
 * balanced block instead; nested matches are skipped because the outer slice already covers them.
 */
function extractDivsByClass(html: string, token: string): string | undefined {
  const openerRe = new RegExp(`<div[^>]*class="[^"]*${escapeRegExp(token)}[^"]*"[^>]*>`, 'gi')
  const chunks: string[] = []
  let coveredUntil = 0
  let opener: RegExpExecArray | null
  while ((opener = openerRe.exec(html))) {
    if (opener.index < coveredUntil) continue
    const start = opener.index + opener[0].length
    let depth = 1
    const tagRe = /<\/?div\b[^>]*>/gi
    tagRe.lastIndex = start
    let match: RegExpExecArray | null
    let end = html.length
    while ((match = tagRe.exec(html))) {
      depth += match[0].startsWith('</') ? -1 : 1
      if (depth === 0) { end = match.index; break }
    }
    chunks.push(html.slice(start, end))
    coveredUntil = end
  }
  return chunks.length > 0 ? chunks.join('\n') : undefined
}

function extractTag(html: string, tag: string): string | undefined {
  const open = new RegExp(`<${tag}\\b[^>]*>`, 'i').exec(html)
  if (!open) return undefined
  const start = open.index + open[0].length
  const close = html.toLowerCase().indexOf(`</${tag}>`, start)
  return close > start ? html.slice(start, close) : html.slice(start)
}

function paragraphsToText(html: string, maxChars: number): string {
  const cleaned = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(nav|header|footer|aside|form|svg|noscript|iframe)\b[\s\S]*?<\/\1>/gi, ' ')

  const blocks: string[] = []
  const blockRe = /<(p|li|h2|h3)\b[^>]*>([\s\S]*?)<\/\1>/gi
  let match: RegExpExecArray | null
  while ((match = blockRe.exec(cleaned))) {
    const text = toPlainText(match[2])
    if (!text || text.length < 15) continue
    if (CHROME_RE.test(text)) continue
    if (blocks[blocks.length - 1] === text) continue
    blocks.push(text)
  }

  const joined = blocks.join('\n\n')
  if (joined.length <= maxChars) return joined
  const slice = joined.slice(0, maxChars)
  const lastSpace = slice.lastIndexOf(' ')
  return lastSpace > maxChars * 0.8 ? slice.slice(0, lastSpace) : slice
}

function toPlainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(Number.parseInt(dec, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&hellip;/gi, '…')
    .replace(/&[lr]squo;/gi, '’')
    .replace(/&[lr]dquo;/gi, '“')
}

function safeCodePoint(code: number): string {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
