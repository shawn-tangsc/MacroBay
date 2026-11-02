import { describe, expect, it } from 'vitest'

import { nodesToPlainText, parseReleaseNotes, releaseNotesLimits } from './releaseNotes'

const kinds = (text: string) => (parseReleaseNotes(text) ?? []).map((node) => node.kind)

describe('parsing a Markdown release note', () => {
  it('turns headings of any level into one section kind, without the level', () => {
    expect(parseReleaseNotes('# 第一行\n## 第二行\n### 第三行')).toEqual([
      { kind: 'section', title: '第一行' },
      { kind: 'section', title: '第二行' },
      { kind: 'section', title: '第三行' }
    ])
  })

  it('accepts a standalone bold line as a section', () => {
    expect(parseReleaseNotes('**已知限制**\n内容一行')).toEqual([
      { kind: 'section', title: '已知限制' },
      { kind: 'paragraph', runs: [{ text: '内容一行', bold: false }] }
    ])
  })

  it('treats -, * and + the same way, and keeps list items out of paragraphs', () => {
    expect(parseReleaseNotes('- 甲\n* 乙\n+ 丙')).toEqual([
      {
        kind: 'list',
        items: [
          [{ text: '甲', bold: false }],
          [{ text: '乙', bold: false }],
          [{ text: '丙', bold: false }]
        ]
      }
    ])
  })

  it('renders an ordered list as paragraphs that still carry the number', () => {
    // `list` 会再画一个圆点：配序号就是「• 1.」，删序号又是丢字。所以走段落、序号留在文字里。
    const nodes = parseReleaseNotes('1. 先装依赖\n2. 再启动')
    expect(nodes).toEqual([
      { kind: 'paragraph', runs: [{ text: '1. 先装依赖', bold: false }] },
      { kind: 'paragraph', runs: [{ text: '2. 再启动', bold: false }] }
    ])
    expect(nodes?.every((node) => node.kind !== 'list')).toBe(true)
  })

  it('keeps a fenced code block verbatim, and never interprets what is inside it', () => {
    const nodes = parseReleaseNotes('```\n- item\n# not a heading\n| a | b |\n```')
    expect(nodes).toEqual([{ kind: 'code', lines: ['- item', '# not a heading', '| a | b |'] }])
    // 块里的 `-` 不许变成列表。
    expect(nodes?.[0]).not.toHaveProperty('items')
  })

  it('turns inline code into a code run and drops the backticks', () => {
    expect(parseReleaseNotes('跑 `pnpm verify` 一次')).toEqual([
      {
        kind: 'paragraph',
        runs: [
          { text: '跑 ', bold: false },
          { text: 'pnpm verify', bold: false, code: true },
          { text: ' 一次', bold: false }
        ]
      }
    ])
  })

  it('keeps only the words of a link or an image, never the address', () => {
    const nodes = parseReleaseNotes('看 [发布页](https://example.invalid/x) 和 ![截图](https://example.invalid/y.png)')
    const plain = nodesToPlainText(nodes ?? [])
    expect(plain).toContain('发布页')
    expect(plain).toContain('截图')
    expect(plain).not.toContain('example.invalid')
    expect(plain).not.toContain('http')
  })

  it('keeps table rows and quotes as ordinary paragraphs instead of dropping them', () => {
    expect(parseReleaseNotes('| 甲 | 乙 |\n> 注意这里')).toEqual([
      { kind: 'paragraph', runs: [{ text: '| 甲 | 乙 |', bold: false }] },
      { kind: 'paragraph', runs: [{ text: '注意这里', bold: false }] }
    ])
  })

  it('shows HTML as literal text and never creates elements', () => {
    const nodes = parseReleaseNotes('<img src=x onerror=alert(1)>')
    expect(nodesToPlainText(nodes ?? [])).toBe('<img src=x onerror=alert(1)>')
  })

  it('keeps every word of a mixed Markdown note (U33: markers may go, words may not)', () => {
    const source = ['# 本次更新', '', '- 修好一个问题', '1. 先升级', '再看 [说明](https://example.invalid)', '```', '- 代码里的连字符', '```', '> 一句引用']
    const plain = nodesToPlainText(parseReleaseNotes(source.join('\n')) ?? [])
    for (const word of ['本次更新', '修好一个问题', '先升级', '再看', '说明', '代码里的连字符', '一句引用']) {
      expect(plain, word).toContain(word)
    }
  })

  it('refuses to show half of an oversized note', () => {
    const many = Array.from({ length: releaseNotesLimits.nodes + 5 }, (_, index) => `- 第 ${index} 条`).join('\n')
    // 超上限整块不显示：部分展示会让读者不知道少了什么。
    expect(parseReleaseNotes(many)).toBeNull()
  })

  it('answers null for an empty note, so the block disappears instead of leaving a shell', () => {
    expect(parseReleaseNotes('')).toBeNull()
    expect(parseReleaseNotes('   \n\n  ')).toBeNull()
  })

  it('only produces the four node kinds the shared contract allows', () => {
    const allowed = new Set(['section', 'paragraph', 'list', 'code'])
    for (const kind of kinds('# a\n- b\nc\n```\nd\n```')) expect(allowed.has(kind)).toBe(true)
  })
})
