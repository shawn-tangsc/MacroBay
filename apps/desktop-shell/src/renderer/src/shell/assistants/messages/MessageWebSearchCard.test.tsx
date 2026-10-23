import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { AssistantWebSearchMessagePart } from '@platform/ai/web-search/assistant/assistantWebSearchMessageParts'

import { platformText } from '../../../i18n/platformText'
import { MessageWebSearchCard } from './MessageWebSearchCard'

function part(toolName: 'web_search' | 'web_fetch'): AssistantWebSearchMessagePart {
  return {
    type: 'web-search',
    toolName,
    status: 'success',
    sources: [{ id: 1, title: 'Example', url: 'https://example.com', snippet: 'Example snippet' }]
  }
}

function markup(toolName: 'web_search' | 'web_fetch', language: 'zh-CN' | 'en-US'): string {
  return renderToStaticMarkup(<MessageWebSearchCard labels={platformText[language].assistants} part={part(toolName)} />)
}

describe('PLAT-55 web search message card title', () => {
  it('uses the page-fetch title for web_fetch tools', () => {
    expect(markup('web_fetch', 'zh-CN')).toContain('网页读取')
    expect(markup('web_fetch', 'zh-CN')).not.toContain('网页搜索')
    expect(markup('web_fetch', 'en-US')).toContain('Page fetch')
  })

  it('keeps the web-search title and source count for web_search tools', () => {
    const zh = platformText['zh-CN'].assistants
    const search = markup('web_search', 'zh-CN')

    expect(search).toContain('网页搜索')
    expect(search).toContain(`1 ${zh.webSearchSources}`)
    expect(search).not.toContain('网页读取')
  })
})
