import type { ReactNode } from 'react'

import type { AppLanguage } from '../../settings/schema/appSettings'

import { JsonBlockView } from './JsonBlockView'
import { parseJsonBlock, type JsonBlock } from './jsonBlock'

/**
 * Markdown for chat bubbles, in the platform so both the shell and a product chat can use it.
 *
 * It was shell-only, and the market-intelligence agent imported it across the product/shell
 * boundary; the reader's report was simply that a table came out as raw pipes, because this parser
 * had no table block at all. Tables are the one construct an LLM answer uses to line up "项目/时间"
 * pairs, so they are parsed here rather than left to the reader's imagination.
 *
 * PLAT-64: 整段结构化 JSON 也在这层识别（`jsonBlock.ts`）—— 它既不是段落也不是表格，按纯文本渲染时
 * 大括号和转义会直接糊在正文里。识别只覆盖**整块**内容；行内 JSON 仍是普通文字。
 */

type ChatMarkdownTextProps = {
  text: string
  className?: string
  codeClassName?: string
  /** 结构化 JSON 的折叠/卡片文案语言；缺省时跟随 `ShellLanguageContext`。 */
  language?: AppLanguage
}

type MarkdownBlock =
  | { kind: 'heading'; depth: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; text: string; language: string | null }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][]; alignments: readonly ('left' | 'center' | 'right')[] }
  | { kind: 'json'; block: JsonBlock }

type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'link'; text: string; href: string }

export default function ChatMarkdownText({
  text,
  className,
  codeClassName,
  language
}: ChatMarkdownTextProps): React.ReactElement | null {
  const blocks = parseMarkdownBlocks(text)
  if (blocks.length === 0) return null
  return (
    <div className={className ?? 'chat-markdown'}>
      {blocks.map((block, index) => renderBlock(block, index, codeClassName, language))}
    </div>
  )
}

function renderBlock(
  block: MarkdownBlock,
  index: number,
  codeClassName?: string,
  language?: AppLanguage
): React.ReactElement {
  if (block.kind === 'heading') {
    const HeadingTag = `h${block.depth}` as 'h1' | 'h2' | 'h3'
    return <HeadingTag key={`heading:${index}`}>{renderInline(block.text)}</HeadingTag>
  }

  if (block.kind === 'code') {
    return (
      <pre key={`code:${index}`} className={codeClassName ?? 'chat-markdown-code'}>
        <code>{block.text}</code>
      </pre>
    )
  }

  if (block.kind === 'table') {
    return (
      <div className="chat-markdown-table" key={`table:${index}`}>
        <table>
          <thead><tr>{block.header.map((cell, cellIndex) =>
            <th key={`${cellIndex}:${cell}`} style={{ textAlign: block.alignments[cellIndex] ?? 'left' }}>{renderInline(cell)}</th>)}</tr></thead>
          <tbody>{block.rows.map((row, rowIndex) =>
            <tr key={rowIndex}>{block.header.map((_, cellIndex) =>
              <td key={cellIndex} style={{ textAlign: block.alignments[cellIndex] ?? 'left' }}>{renderInline(row[cellIndex] ?? '')}</td>)}</tr>)}</tbody>
        </table>
      </div>
    )
  }

  if (block.kind === 'json') {
    return <JsonBlockView key={`json:${index}`} block={block.block} codeClassName={codeClassName} language={language} />
  }

  if (block.kind === 'list') {
    const ListTag = block.ordered ? 'ol' : 'ul'
    return (
      <ListTag key={`list:${index}`}>
        {block.items.map((item, itemIndex) => (
          <li key={`${itemIndex}:${item}`}>{renderInline(item)}</li>
        ))}
      </ListTag>
    )
  }

  return <p key={`paragraph:${index}`}>{renderInline(block.text)}</p>
}

function renderInline(text: string): ReactNode[] {
  return tokenizeInline(text).map((token, index) => {
    if (token.kind === 'code') return <code key={index}>{token.text}</code>
    if (token.kind === 'strong') return <strong key={index}>{renderInline(token.text)}</strong>
    if (token.kind === 'link') return <a key={index} href={token.href} target="_blank" rel="noreferrer">{token.text}</a>
    return token.text
  })
}

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let code: { language: string | null; lines: string[] } | null = null

  const flushParagraph = (): void => {
    const text = paragraph.join('\n').trim()
    paragraph = []
    if (!text) return
    // 整段 JSON 先于段落判定：它不是"一段文字"，但解析失败时必须原样回到段落（绝不吞内容）。
    const jsonBlock = parseJsonBlock(text)
    blocks.push(jsonBlock ? { kind: 'json', block: jsonBlock } : { kind: 'paragraph', text })
  }
  const flushList = (): void => {
    if (list && list.items.length > 0) blocks.push({ kind: 'list', ordered: list.ordered, items: list.items })
    list = null
  }

  for (const [lineIndex, line] of lines.entries()) {
    const fence = line.match(/^```([A-Za-z0-9_-]+)?\s*$/)
    if (fence) {
      if (code) {
        blocks.push({ kind: 'code', language: code.language, text: code.lines.join('\n') })
        code = null
      } else {
        flushParagraph()
        flushList()
        code = { language: fence[1] ?? null, lines: [] }
      }
      continue
    }

    if (code) {
      code.lines.push(line)
      continue
    }

    // A table is recognised by its separator row (`| --- | :--: |`), which lets the header row be
    // the last paragraph line and every following pipe row be body content.
    const separator = line.match(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/)
    const headerLine = paragraph.at(-1)
    if (separator && headerLine && headerLine.includes('|')) {
      const header = splitTableRow(headerLine)
      const alignments = splitTableRow(line).map(cell => cell.startsWith(':') && cell.endsWith(':') ? 'center' as const
        : cell.endsWith(':') ? 'right' as const : 'left' as const)
      if (header.length === alignments.length) {
        paragraph.pop()
        flushParagraph()
        flushList()
        const rows: string[][] = []
        let cursor = lineIndex + 1
        while (cursor < lines.length && lines[cursor]!.includes('|') && lines[cursor]!.trim()) {
          rows.push(splitTableRow(lines[cursor]!))
          cursor += 1
        }
        blocks.push({ kind: 'table', header, rows, alignments })
        for (let skip = lineIndex + 1; skip < cursor; skip += 1) lines[skip] = ''
        continue
      }
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      flushParagraph()
      flushList()
      blocks.push({ kind: 'heading', depth: heading[1]!.length as 1 | 2 | 3, text: heading[2]!.trim() })
      continue
    }

    const unordered = line.match(/^\s*[-*]\s+(.+)$/)
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/)
    if (unordered || ordered) {
      flushParagraph()
      const orderedList = Boolean(ordered)
      if (!list || list.ordered !== orderedList) {
        flushList()
        list = { ordered: orderedList, items: [] }
      }
      list.items.push((unordered?.[1] ?? ordered?.[1] ?? '').trim())
      continue
    }

    if (!line.trim()) {
      flushParagraph()
      flushList()
      continue
    }

    flushList()
    paragraph.push(line)
  }

  if (code) blocks.push({ kind: 'code', language: code.language, text: code.lines.join('\n') })
  flushParagraph()
  flushList()
  return blocks
}

function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  let cursor = 0
  const pattern = /(\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) tokens.push({ kind: 'text', text: text.slice(cursor, match.index) })
    if (match[2] != null && isSafeExternalUrl(match[3])) {
      tokens.push({ kind: 'link', text: match[2], href: match[3] })
    } else if (match[2] != null) {
      tokens.push({ kind: 'text', text: match[0] })
    } else if (match[4] != null) {
      tokens.push({ kind: 'code', text: match[4] })
    } else {
      tokens.push({ kind: 'strong', text: match[5] ?? match[0] })
    }
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) tokens.push({ kind: 'text', text: text.slice(cursor) })
  return tokens
}

function isSafeExternalUrl(value: string | undefined): value is string {
  if (!value) return false
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** One table row: outer pipes are optional and empty cells are kept as empty strings. */
function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
}
