import { NEWS_SENTIMENT_LIMITS } from '../schema/newsSentiment'

type SlateNode = {
  node?: string
  text?: string
  tag?: string
  child?: SlateNode[]
}

export type ExtractedBinanceBody = {
  text: string
  chars: number
  state: 'available' | 'too-short'
}

/**
 * The public detail page is behind a WAF challenge, but the same announcement is served by the
 * public CMS detail API. The article code is the last path segment on both URL shapes.
 */
export function binanceAnnouncementCodeFromUrl(url: string): string | undefined {
  const detail = /\/detail\/([A-Za-z0-9]+)/.exec(url)
  if (detail) return detail[1]
  const plain = /\/announcement\/([A-Za-z0-9]+)(?:$|[?#])/.exec(url)
  return plain?.[1]
}

export function binanceAnnouncementDetailUrl(code: string): string {
  return `https://www.binance.com/bapi/composite/v1/public/cms/article/detail/query?articleCode=${encodeURIComponent(code)}`
}

export function extractBinanceAnnouncementBody(input: { json: string; maxChars?: number }): ExtractedBinanceBody {
  const maxChars = input.maxChars ?? NEWS_SENTIMENT_LIMITS.bodyChars
  let text = ''
  try {
    const envelope = JSON.parse(input.json) as { data?: { body?: unknown } }
    const raw = envelope.data?.body
    const tree = typeof raw === 'string' ? JSON.parse(raw) as SlateNode : raw as SlateNode | undefined
    text = tree ? slateToText(tree) : ''
  } catch {
    text = ''
  }
  const trimmed = text.slice(0, maxChars).trim()
  return {
    text: trimmed,
    chars: trimmed.length,
    state: trimmed.length >= 200 ? 'available' : 'too-short'
  }
}

function slateToText(root: SlateNode): string {
  const blocks: string[] = []
  let current = ''
  const flush = () => {
    const text = current.replace(/\s+/g, ' ').trim()
    if (text) blocks.push(text)
    current = ''
  }
  const walk = (node: SlateNode): void => {
    if (typeof node.text === 'string') current += node.text
    if (node.tag === 'p' || node.tag === 'li' || node.tag === 'h1' || node.tag === 'h2' || node.tag === 'h3') {
      if (node.child) node.child.forEach(walk)
      flush()
      return
    }
    if (node.child) {
      node.child.forEach(walk)
      if (node.node === 'element' && (node.tag === 'div' || node.tag === 'br')) flush()
    }
  }
  walk(root)
  flush()
  return blocks.join('\n\n')
}
