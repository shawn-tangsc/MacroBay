import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import ChatMarkdownText, { parseMarkdownBlocks } from './ChatMarkdownText'

describe('platform chat markdown', () => {
  it('parses a table, which is what an answer uses to line up label/value pairs', () => {
    const blocks = parseMarkdownBlocks([
      '发布时间（已确认）',
      '',
      '| 项目 | 时间 |',
      '| --- | --- |',
      '| 日期 | 2026-10-14（星期三，即今天） |',
      '| UTC | 06:00 |',
      '| 北京时间 | 14:00 |'
    ].join('\n'))

    expect(blocks).toHaveLength(2)
    expect(blocks[1]).toEqual({
      kind: 'table',
      header: ['项目', '时间'],
      rows: [['日期', '2026-10-14（星期三，即今天）'], ['UTC', '06:00'], ['北京时间', '14:00']],
      alignments: ['left', 'left']
    })
  })

  it('renders that table as a real table instead of leaving the pipes in the text', () => {
    const html = renderToStaticMarkup(<ChatMarkdownText text={'| a | b |\n| --- | ---: |\n| 1 | 2 |'} />)

    expect(html).toContain('<table>')
    expect(html).toContain('<th')
    expect(html).toContain('<td')
    expect(html).toContain('text-align:right')
    expect(html).not.toContain('| --- |')
  })

  it('leaves a pipe row that has no separator as the paragraph it is', () => {
    expect(parseMarkdownBlocks('| 项目 | 时间 |')).toEqual([{ kind: 'paragraph', text: '| 项目 | 时间 |' }])
    // A separator without a header above it is a paragraph too: nothing to tabulate.
    expect(parseMarkdownBlocks('| --- | --- |')).toEqual([{ kind: 'paragraph', text: '| --- | --- |' }])
  })

  it('keeps the blocks around the table, and the inline formatting inside its cells', () => {
    const html = renderToStaticMarkup(<ChatMarkdownText text={'before\n\n| **k** | v |\n| --- | --- |\n| `x` | y |\n\nafter'} />)

    expect(html).toContain('<p>before</p>')
    expect(html).toContain('<strong>k</strong>')
    expect(html).toContain('<code>x</code>')
    expect(html).toContain('<p>after</p>')
  })

  it('does not swallow a following list or heading as table rows', () => {
    const blocks = parseMarkdownBlocks('| a |\n| --- |\n| 1 |\n\n- item')
    expect(blocks.map(block => block.kind)).toEqual(['table', 'list'])
  })
})
