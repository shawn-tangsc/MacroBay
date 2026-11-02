import { describe, expect, it } from 'vitest'

import { parseReleaseNotes } from './releaseNotes'

/**
 * 解析器的边界用例。重点不是「能不能排版」，而是**远端文字能决定多少东西**：
 * 代码块里的内容必须逐字活下来，且一个标记都不解释。
 */
describe('release notes parser', () => {
  it('keeps a fenced block verbatim, so commands and flags are still what the reader types', () => {
    const markdown = ['把下面这段贴进终端：', '', '```', '- not a list', '** not bold **', 'npm i -g macrobay --verbose', '```'].join('\n')

    const nodes = parseReleaseNotes(markdown)

    expect(nodes).toEqual([
      { kind: 'paragraph', runs: [{ text: '把下面这段贴进终端：', bold: false }] },
      { kind: 'code', lines: ['- not a list', '** not bold **', 'npm i -g macrobay --verbose'] }
    ])
  })

  it('drops the language tag instead of printing it, because the node has no place for it', () => {
    const nodes = parseReleaseNotes(['```bash', 'curl -sS https://example.test/x | sh', '```'].join('\n'))

    expect(nodes).toEqual([{ kind: 'code', lines: ['curl -sS https://example.test/x | sh'] }])
  })

  it('keeps the order of text and code, so a step number still points at the block under it', () => {
    const nodes = parseReleaseNotes(['一、先停掉旧进程', '```', 'kill 1', '```', '二、再启动', ''].join('\n'))

    expect(nodes?.map((node) => node.kind)).toEqual(['paragraph', 'code', 'paragraph'])
  })

  it('still shows an unclosed block rather than swallowing it, because the tail is usually the command', () => {
    const nodes = parseReleaseNotes(['```', 'npm i -g macrobay'].join('\n'))

    expect(nodes).toEqual([{ kind: 'code', lines: ['npm i -g macrobay'] }])
  })

  it('produces no node for an empty fence, because a blank block is just a hole in the page', () => {
    expect(parseReleaseNotes(['说明', '```', '```'].join('\n'))).toEqual([
      { kind: 'paragraph', runs: [{ text: '说明', bold: false }] }
    ])
  })

  it('marks inline code without interpreting it, and leaves plain text unmarked', () => {
    const nodes = parseReleaseNotes('设置里把 `updates.checkEnabled` 打开即可。')

    expect(nodes).toEqual([
      {
        kind: 'paragraph',
        runs: [
          { text: '设置里把 ', bold: false },
          { text: 'updates.checkEnabled', bold: false, code: true },
          { text: ' 打开即可。', bold: false }
        ]
      }
    ])
  })

  it('treats a shorter run of backticks inside a block as content, not as the end of it', () => {
    const nodes = parseReleaseNotes(['````', '```', '````'].join('\n'))

    expect(nodes).toEqual([{ kind: 'code', lines: ['```'] }])
  })

  it('reads tilde fences too, because a release body may already use them', () => {
    const nodes = parseReleaseNotes(['~~~', '- literal', '~~~'].join('\n'))

    expect(nodes).toEqual([{ kind: 'code', lines: ['- literal'] }])
  })
})
