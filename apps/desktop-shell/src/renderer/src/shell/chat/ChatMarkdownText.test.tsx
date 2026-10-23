import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import ChatMarkdownText from './ChatMarkdownText'

describe('ChatMarkdownText', () => {
  it('renders safe http links as external markdown links', () => {
    const markup = renderToStaticMarkup(
      <ChatMarkdownText text="来源：[官方公告](https://example.com/news/1)" />
    )

    expect(markup).toContain('<a href="https://example.com/news/1" target="_blank" rel="noreferrer">官方公告</a>')
    expect(markup).not.toContain('[官方公告](')
  })

  it('does not turn non-http markdown targets into executable links', () => {
    const markup = renderToStaticMarkup(
      <ChatMarkdownText text="不要打开：[脚本](javascript:alert(1))" />
    )

    expect(markup).not.toContain('<a ')
    expect(markup).toContain('[脚本](javascript:alert(1))')
  })
})
