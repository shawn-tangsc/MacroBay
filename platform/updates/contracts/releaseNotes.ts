import type { StructuredTextNode, StructuredTextRun } from '@platform/contracts/structuredText'

/**
 * 更新说明正文的解析：**输入是 Markdown，输出是封闭节点结构**（契约在 `platform/contracts/structuredText`）。
 *
 * 总原则：**任何块都不许静默丢弃**——认不出的行一律当一个段落原样显示。宁可难看，不许少字。
 *
 * 对照表（技术方案 §13.7.2，逐行可测）：
 * - 行首 `#`…（任意级）→ `section`，级号不保留；
 * - 独占一行的 `**粗体**` → `section`；
 * - `-` / `*` / `+`（后跟空格）→ `list` 的一项；
 * - `1.` / `1)` → **每个一项一个段落**，序号原样留在文字里（`list` 会画圆点，配序号就是「• 1.」双标记）；
 * - 围栏代码块 → `code` 节点，**原样逐行、块内不解释任何标记**；
 * - 表格行、引用、认不出的行 → 一个段落（不画表格、去掉 `>`）；
 * - 行内 `**粗体**` → `bold`；行内 `` `代码` `` → `code: true`；
 * - `[文字](地址)` / `![说明](图片)` → 只留文字/说明，地址丢掉。
 *
 * 上限：正文 20,000 字符（超出截断）；节点 200 个——**超了整块不显示**，不截断到 200 再丢后半段
 * （部分展示比没有更危险：读者不知道少了什么）。
 */

export const releaseNotesLimits = {
  bodyBytes: 256 * 1024,
  textCharacters: 20_000,
  nodes: 200
} as const

export type ReleaseNotesParseResult = {
  nodes: StructuredTextNode[]
  /** 内容被截到上限：页面据此多渲染**一行**「正文过长…」。取不到正文是另一回事（整块不存在）。 */
  truncated: boolean
}

export function parseReleaseNotes(markdown: string): ReleaseNotesParseResult | null {
  if (typeof markdown !== 'string') return null
  const full = markdown.replace(/\r\n?/gu, '\n')
  if (full.trim().length === 0) return null
  // 内容太长：**截到上限并告知**（悄悄截断和整块消失都是沉默，两个都不要）。
  const truncatedText = full.length > releaseNotesLimits.textCharacters
  const text = truncatedText ? full.slice(0, releaseNotesLimits.textCharacters) : full

  const nodes: StructuredTextNode[] = []
  let paragraph: StructuredTextRun[] = []
  let listItems: StructuredTextRun[][] = []

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return
    nodes.push({ kind: 'paragraph', runs: paragraph })
    paragraph = []
  }
  const flushList = (): void => {
    if (listItems.length === 0) return
    nodes.push({ kind: 'list', items: listItems })
    listItems = []
  }
  const flushAll = (): void => {
    flushParagraph()
    flushList()
  }
  const pushParagraph = (line: string): void => {
    flushAll()
    const runs = parseRuns(line)
    if (runs.length > 0) nodes.push({ kind: 'paragraph', runs })
  }

  const lines = text.split('\n')
  let index = 0
  while (index < lines.length) {
    const raw = lines[index]
    const line = raw.trimEnd()
    const trimmed = line.trim()
    index += 1

    // 围栏代码块：整块原样收进 code 节点，块内不解释任何标记。
    const fence = /^ {0,3}(```|~~~)/u.exec(line)
    if (fence !== null) {
      flushAll()
      const marker = fence[1]
      const body: string[] = []
      while (index < lines.length) {
        const candidate = lines[index]
        index += 1
        if (new RegExp(`^ {0,3}${marker}\\s*$`, 'u').test(candidate)) break
        body.push(candidate.trimEnd())
      }
      nodes.push({ kind: 'code', lines: body })
      continue
    }

    if (trimmed.length === 0) {
      flushAll()
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/u.exec(trimmed)
    if (heading !== null) {
      flushAll()
      const title = plainText(heading[2])
      if (title.length > 0) nodes.push({ kind: 'section', title })
      continue
    }

    const boldHeading = /^\*\*(.+)\*\*$/u.exec(trimmed)
    if (boldHeading !== null) {
      flushAll()
      const title = plainText(boldHeading[1])
      if (title.length > 0) nodes.push({ kind: 'section', title })
      continue
    }

    const bullet = /^[-*+]\s+(.*)$/u.exec(trimmed)
    if (bullet !== null) {
      flushParagraph()
      listItems.push(parseRuns(bullet[1]))
      continue
    }

    // 有序列表：序号留在文字里，走段落——`list` 会再画一个圆点，变成「• 1. xxx」。
    const ordered = /^\d+[.)]\s+/u.test(trimmed)
    if (ordered) {
      pushParagraph(trimmed)
      continue
    }

    // 引用：只去掉行首的 `>`。
    if (/^>\s?/u.test(trimmed)) {
      pushParagraph(trimmed.replace(/^>\s?/u, ''))
      continue
    }

    flushList()
    paragraph.push(...parseRuns(trimmed))
    flushParagraph()
  }
  flushAll()

  if (nodes.length === 0) return null
  // 上限按「内容单元」数：一个列表的每一项也算一个，否则 200 条项目符号会被当成 1 个节点混过去。
  const units = nodes.reduce((total, node) => total + (node.kind === 'list' ? node.items.length : 1), 0)
  if (units <= releaseNotesLimits.nodes) return { nodes, truncated: truncatedText }
  // 超上限也是「内容太长」：截到上限，同样告知。
  return { nodes: truncateToUnits(nodes, releaseNotesLimits.nodes), truncated: true }
}

/** 按内容单元截断：列表按项切，其余一类算一个。 */
function truncateToUnits(nodes: StructuredTextNode[], limit: number): StructuredTextNode[] {
  const kept: StructuredTextNode[] = []
  let used = 0
  for (const node of nodes) {
    if (used >= limit) break
    if (node.kind !== 'list') {
      kept.push(node)
      used += 1
      continue
    }
    const room = limit - used
    kept.push({ kind: 'list', items: node.items.slice(0, room) })
    used += Math.min(room, node.items.length)
  }
  return kept
}

/** 行内解析：只切 `**加粗**`、`` `代码` ``、`[文字](地址)`、`![说明](图片)`；其余原样保留。 */
export function parseRuns(line: string): StructuredTextRun[] {
  const runs: StructuredTextRun[] = []
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`|!\[([^\]]*)\]\([^)]*\)|\[([^\]]*)\]\([^)]*\)/gu
  let cursor = 0
  for (const match of line.matchAll(pattern)) {
    const at = match.index ?? 0
    if (at > cursor) runs.push({ text: line.slice(cursor, at), bold: false })
    if (match[1] !== undefined) runs.push({ text: match[1], bold: true })
    else if (match[2] !== undefined) runs.push({ text: match[2], bold: false, code: true })
    else if (match[3] !== undefined) runs.push({ text: match[3], bold: false })
    else if (match[4] !== undefined) runs.push({ text: match[4], bold: false })
    cursor = at + match[0].length
  }
  if (cursor < line.length) runs.push({ text: line.slice(cursor), bold: false })
  return runs.length === 0 ? [] : runs
}

/** 标题里不保留任何标记：把片段拼成纯文字。 */
function plainText(line: string): string {
  return parseRuns(line)
    .map((run) => run.text)
    .join('')
    .trim()
}

/** 把渲染出的节点还原成「读者能看到的词」，供「文字不丢」那条用例比对。 */
export function nodesToPlainText(nodes: readonly StructuredTextNode[]): string {
  const parts: string[] = []
  for (const node of nodes) {
    if (node.kind === 'section') parts.push(node.title)
    else if (node.kind === 'code') parts.push(...node.lines)
    else if (node.kind === 'paragraph') parts.push(node.runs.map((run) => run.text).join(''))
    else parts.push(...node.items.map((item) => item.map((run) => run.text).join('')))
  }
  return parts.join('\n')
}
