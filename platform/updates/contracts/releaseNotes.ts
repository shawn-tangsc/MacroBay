/**
 * 更新说明正文的受控解析：**只认五样**——小节标题、项目符号、段落、行内加粗、行内代码，
 * 外加围栏代码块。
 *
 * 这是「远端文字第一次进门」，所以边界写成结构而不是建议：
 * - 输出是 `StructuredTextNode`（`platform/contracts/structuredText.ts` 一份定义，渲染层读同一份），
 *   **没有「原始 HTML」字段**，渲染层拿不到原文；
 * - HTML 标签、表格、图片、引用**一律当普通文字**；
 * - 围栏代码块里的内容**一个字符都不解释**：`-` 不是列表、`**` 不是加粗、`<img>` 不是元素；
 * - `[文字](地址)` 只留「文字」，地址丢掉；裸地址照旧是文字、不可点。
 *
 * 纯函数：同样的输入永远同样的输出，单测不需要网络。
 */
import type { StructuredTextNode, StructuredTextRun } from '../../contracts/structuredText'

/** 三个上限：宁可不显示，也不让远端决定我们的内存。 */
export const releaseNotesLimits = {
  bodyBytes: 256 * 1024,
  textCharacters: 20_000,
  nodes: 200
} as const

/**
 * 解析正文。返回 `null` 表示「没有可显示的说明」——空正文、超限都算没有，
 * 由调用方表现为「整块不出现」，不是报错块。
 */
export function parseReleaseNotes(markdown: string): StructuredTextNode[] | null {
  if (typeof markdown !== 'string') return null
  let text = markdown.replace(/\r\n?/gu, '\n').trim()
  if (text.length === 0) return null
  if (text.length > releaseNotesLimits.textCharacters) {
    text = text.slice(0, releaseNotesLimits.textCharacters)
  }

  const nodes: StructuredTextNode[] = []
  let paragraph: StructuredTextRun[] = []
  let list: StructuredTextRun[][] = []
  /** 当前围栏的标记（``` 或 ~~~）；`null` 表示不在代码块里。 */
  let fenceMarker: string | null = null
  let codeLines: string[] = []

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return
    nodes.push({ kind: 'paragraph', runs: paragraph })
    paragraph = []
  }
  const flushList = (): void => {
    if (list.length === 0) return
    nodes.push({ kind: 'list', items: list })
    list = []
  }
  const flushCode = (): void => {
    // 空的围栏不产出一个空 `<pre>`：那在页面上只是一块空白。
    if (codeLines.length > 0) nodes.push({ kind: 'code', lines: codeLines })
    codeLines = []
    fenceMarker = null
  }
  const flushAll = (): void => {
    flushParagraph()
    flushList()
    flushCode()
  }

  for (const rawLine of text.split('\n')) {
    // 代码块里**只认结束围栏**，其余行逐字收下（不 trim、不解释任何标记）。
    if (fenceMarker !== null) {
      if (isClosingFence(rawLine, fenceMarker)) flushCode()
      else codeLines.push(rawLine)
      continue
    }

    const opening = openingFenceMarker(rawLine)
    if (opening !== null) {
      flushParagraph()
      flushList()
      fenceMarker = opening
      codeLines = []
      continue
    }

    const line = rawLine.trimEnd()
    const trimmed = line.trim()

    if (trimmed.length === 0) {
      flushParagraph()
      flushList()
      continue
    }

    // 小节标题：`###` 系列，或独占一行的 `**粗体**`。
    const hashes = /^(#{1,6})\s+(.*)$/u.exec(trimmed)
    if (hashes !== null) {
      flushParagraph()
      flushList()
      const title = stripInlineMarkup(hashes[2])
      if (title.length > 0) nodes.push({ kind: 'section', title })
      continue
    }
    const boldLine = /^\*\*(.+)\*\*$/u.exec(trimmed)
    if (boldLine !== null) {
      flushParagraph()
      flushList()
      const title = stripInlineMarkup(boldLine[1])
      if (title.length > 0) nodes.push({ kind: 'section', title })
      continue
    }

    // 项目符号：`-` / `*` / `•`（`*` 后必须跟空白，否则会被当成粗体开头）。
    const bullet = /^[-*•]\s+(.*)$/u.exec(trimmed)
    if (bullet !== null) {
      flushParagraph()
      list.push(parseRuns(bullet[1]))
      continue
    }

    flushList()
    paragraph.push(...parseRuns(trimmed))
  }
  flushAll()

  if (nodes.length === 0) return null
  return nodes.length > releaseNotesLimits.nodes ? nodes.slice(0, releaseNotesLimits.nodes) : nodes
}

/** 开围栏：行首三个以上反引号或波浪号，可带语言标记（**语言只用来认出这是围栏，不进节点**）。 */
function openingFenceMarker(line: string): string | null {
  const match = /^\s{0,3}(`{3,}|~{3,})\s*\S*\s*$/u.exec(line)
  if (match === null) return null
  const marker = match[1]
  // 反引号围栏的语言标记里不能再出现反引号（CommonMark 的同一条限制），否则就是普通文字。
  if (marker.startsWith('`') && line.slice(line.indexOf(marker) + marker.length).includes('`')) return null
  return marker
}

/** 结束围栏：标记相同、只允许尾随空白；比开围栏短的不算结束。 */
function isClosingFence(line: string, marker: string): boolean {
  const trimmed = line.trim()
  if (trimmed.length < marker.length) return false
  const unit = marker[0]
  for (const character of trimmed) if (character !== unit) return false
  return true
}

/**
 * 行内解析：只切 `**加粗**`、`` `代码` `` 与 `[文字](地址)`。**其余字符原样保留**——
 * 所以 HTML 标签就是一段普通文字，渲染时由 React 当文本转义。
 */
export function parseRuns(line: string): StructuredTextRun[] {
  const runs: StructuredTextRun[] = []
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]*)\]\([^)]*\)/gu
  let cursor = 0
  for (const match of line.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) runs.push({ text: line.slice(cursor, index), bold: false })
    if (match[1] !== undefined) runs.push({ text: match[1], bold: true })
    else if (match[2] !== undefined) runs.push({ text: match[2], bold: false, code: true })
    // 链接：只留文字，地址丢掉。
    else if (match[3]) runs.push({ text: match[3], bold: false })
    cursor = index + match[0].length
  }
  if (cursor < line.length) runs.push({ text: line.slice(cursor), bold: false })
  return runs.length === 0 ? [{ text: line, bold: false }] : runs
}

/** 标题里不保留任何标记，避免把 `**` 或链接语法显示给读者。 */
function stripInlineMarkup(line: string): string {
  return parseRuns(line)
    .map((run) => run.text)
    .join('')
    .trim()
}
