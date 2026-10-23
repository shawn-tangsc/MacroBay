import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import AgentMarkdownText from './AgentMarkdownText'

describe('AgentMarkdownText', () => {
  it('renders common assistant markdown without raw markdown markers', () => {
    const markup = renderToStaticMarkup(
      <AgentMarkdownText
        text={[
          '找到 Python：`/usr/local/bin/python3`',
          '',
          '**输出结果：**',
          '```',
          'Hello, World!',
          '```',
          '',
          '- ✅ 运行成功',
          '- 文件：`hello.py`'
        ].join('\n')}
      />
    )

    expect(markup).toContain('<strong>输出结果：</strong>')
    expect(markup).toContain('<code>/usr/local/bin/python3</code>')
    expect(markup).toContain('<pre class="agent-markdown-code"><code>Hello, World!</code></pre>')
    expect(markup).toContain('<ul>')
    expect(markup).toContain('<li>✅ 运行成功</li>')
    expect(markup).not.toContain('**输出结果：**')
    expect(markup).not.toContain('```')
  })
})
