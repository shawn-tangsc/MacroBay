import { describe, expect, it } from 'vitest'

import {
  buildChatCompletionsUrl,
  buildGeminiGenerateUrl,
  buildMessagesUrl,
  buildResponsesUrl
} from './providerEndpoints'

/**
 * PLAT-72 阶段 3：请求 URL 的**唯一实现**。
 *
 * 这四条规则原先在 8 个文件里各写一份（openAiChatCompletionClient / providerConnection /
 * agentChatRuntime / assistantOpenAiStreamClient / messagesChatClient / responsesChatClient /
 * geminiChatClient / providerGeminiModelProbe / endpointProbe 的 buildProbeUrl），
 * 差异只体现在边角（`/openai` 后缀、`/v1beta` 版本段）。这里把口径钉死：
 *  - base 已带版本段（`/v1`、`/v1beta`、`/v3` …）⇒ 只补叶子路径；
 *  - base 以 `/openai` 结尾（Google 兼容前缀）⇒ 只补叶子路径；
 *  - 其余 ⇒ 先补 `/v1`。
 */
describe('PLAT-72 provider endpoint urls', () => {
  it('builds chat/completions urls without duplicating the version segment', () => {
    expect(buildChatCompletionsUrl('https://api.deepseek.com')).toBe('https://api.deepseek.com/v1/chat/completions')
    expect(buildChatCompletionsUrl('https://api.deepseek.com/')).toBe('https://api.deepseek.com/v1/chat/completions')
    expect(buildChatCompletionsUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/chat/completions')
    expect(buildChatCompletionsUrl('https://ark.cn-beijing.volces.com/api/v3/'))
      .toBe('https://ark.cn-beijing.volces.com/api/v3/chat/completions')
    expect(buildChatCompletionsUrl('https://generativelanguage.googleapis.com/v1beta/openai'))
      .toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
    // `.../openai` 结尾但没有版本段 ⇒ 仍要补 `/v1`（Groq / LongCat / PPIO 的真实请求地址）。
    expect(buildChatCompletionsUrl('https://api.groq.com/openai'))
      .toBe('https://api.groq.com/openai/v1/chat/completions')
    expect(buildChatCompletionsUrl('https://api.longcat.chat/openai'))
      .toBe('https://api.longcat.chat/openai/v1/chat/completions')
    expect(buildChatCompletionsUrl('http://localhost:1234')).toBe('http://localhost:1234/v1/chat/completions')
  })

  it('builds responses urls on the versioned base', () => {
    expect(buildResponsesUrl('https://api.openai.com')).toBe('https://api.openai.com/v1/responses')
    expect(buildResponsesUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/responses')
    expect(buildResponsesUrl('https://ark.cn-beijing.volces.com/api/v3/'))
      .toBe('https://ark.cn-beijing.volces.com/api/v3/responses')
  })

  it('builds anthropic messages urls and keeps provider prefixes', () => {
    expect(buildMessagesUrl('https://api.anthropic.com')).toBe('https://api.anthropic.com/v1/messages')
    expect(buildMessagesUrl('https://api.anthropic.com/')).toBe('https://api.anthropic.com/v1/messages')
    expect(buildMessagesUrl('https://api.anthropic.com/v1')).toBe('https://api.anthropic.com/v1/messages')
    expect(buildMessagesUrl('https://api.deepseek.com/anthropic')).toBe('https://api.deepseek.com/anthropic/v1/messages')
    expect(buildMessagesUrl('https://cephalon.cloud/user-center/v1'))
      .toBe('https://cephalon.cloud/user-center/v1/messages')
  })

  it('builds gemini native urls and normalises the model id', () => {
    const host = 'https://generativelanguage.googleapis.com'
    expect(buildGeminiGenerateUrl(host, 'gemini-2.5-flash'))
      .toBe(`${host}/v1beta/models/gemini-2.5-flash:generateContent`)
    expect(buildGeminiGenerateUrl(`${host}/v1`, 'gemini-2.5-flash'))
      .toBe(`${host}/v1beta/models/gemini-2.5-flash:generateContent`)
    expect(buildGeminiGenerateUrl(`${host}/v1beta`, 'gemini-2.5-flash'))
      .toBe(`${host}/v1beta/models/gemini-2.5-flash:generateContent`)
    expect(buildGeminiGenerateUrl(`${host}/`, 'models/gemini-2.5-flash'))
      .toBe(`${host}/v1beta/models/gemini-2.5-flash:generateContent`)
  })

})
