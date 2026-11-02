import { describe, expect, it } from 'vitest'

import type { AssistantMessageEntity } from '../schemas/messageSchemas'
import {
  ASSISTANT_CONTEXT_MIN_RECENT_TURNS,
  ASSISTANT_CONTEXT_RESERVE_FOR_REPLY_TOKENS,
  planAssistantContext,
  toChatCompletionMessages
} from './assistantContextPlan'

function message(
  id: string,
  role: 'system' | 'user' | 'assistant',
  text: string
): AssistantMessageEntity {
  return {
    id,
    topicId: 'topic',
    parentId: null,
    role,
    data: { parts: [{ type: 'text', text }] },
    searchableText: text,
    status: 'success',
    siblingsGroupId: 0,
    modelId: null,
    modelSnapshot: null,
    stats: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z'
  }
}

/**
 * 旧实现：整条分支原样拼出去，没有上限。保留一份逐字副本，用来证明短会话行为没变。
 * 不要把它抽成共享函数——它只是对拍基准，改它就让对拍失去意义。
 */
function legacyMessages(
  prompt: string,
  branch: readonly AssistantMessageEntity[],
  latestUserText: string
): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = []
  if (prompt.trim()) messages.push({ role: 'system', content: prompt.trim() })
  for (const item of branch) {
    const text = item.data.parts
      .flatMap((part) => (part.type === 'text' && typeof part.text === 'string' ? [part.text] : []))
      .join('\n')
      .trim()
    if (!text) continue
    messages.push({ role: item.role, content: text })
  }
  const last = messages[messages.length - 1]
  if (last?.role !== 'user' || last.content !== latestUserText) {
    messages.push({ role: 'user', content: latestUserText })
  }
  return messages
}

const shortConversation: AssistantMessageEntity[] = [
  message('u1', 'user', '你好'),
  message('a1', 'assistant', '你好，有什么可以帮你？'),
  message('u2', 'user', '帮我看一下这条消息')
]

describe('planAssistantContext', () => {
  it('matches the previous implementation verbatim when everything fits the budget', () => {
    const prompt = '你是助手。'
    const plan = planAssistantContext({
      assistantPrompt: prompt,
      branch: shortConversation,
      latestUserText: '帮我看一下这条消息',
      contextWindow: 100_000
    })

    expect(toChatCompletionMessages(plan)).toEqual(legacyMessages(prompt, shortConversation, '帮我看一下这条消息'))
    expect(plan.droppedTurns).toBe(0)
    expect(plan.truncatedMessages).toBe(0)
  })

  it('does not duplicate the latest user message when the branch already ends with it', () => {
    const plan = planAssistantContext({
      assistantPrompt: '',
      branch: shortConversation,
      latestUserText: '帮我看一下这条消息',
      contextWindow: 100_000
    })

    const userMessages = plan.messages.filter((item) => item.role === 'user')
    expect(userMessages.at(-1)?.content).toBe('帮我看一下这条消息')
    expect(userMessages.filter((item) => item.content === '帮我看一下这条消息')).toHaveLength(1)
  })

  it('replays twenty rounds and reports how many turns it had to drop', () => {
    const branch: AssistantMessageEntity[] = []
    for (let round = 1; round <= 20; round += 1) {
      branch.push(message(`u${round}`, 'user', `第 ${round} 个问题：${'问'.repeat(400)}`))
      branch.push(message(`a${round}`, 'assistant', `第 ${round} 个回答：${'答'.repeat(400)}`))
    }
    branch.push(message('u21', 'user', '当前这个问题'))

    const plan = planAssistantContext({
      assistantPrompt: '你是助手。',
      branch,
      latestUserText: '当前这个问题',
      contextWindow: 8192
    })

    expect(plan.droppedTurns).toBeGreaterThan(0)
    expect(plan.keptTurns + plan.droppedTurns).toBe(21)
    // 当前提问永远在最后，且不能被丢掉。
    expect(plan.messages.at(-1)).toEqual({ role: 'user', content: '当前这个问题' })
    // 首条不能是 assistant：丢掉整轮，而不是丢半个。
    expect(plan.messages[0]?.role).not.toBe('assistant')
  })

  it('keeps the current question even when system and question exceed the window, and says so', () => {
    const plan = planAssistantContext({
      assistantPrompt: '你是助手。'.repeat(2000),
      branch: [message('u1', 'user', '历史问题'), message('a1', 'assistant', '历史回答')],
      latestUserText: '当前这个问题',
      contextWindow: 1000
    })

    expect(plan.overflow).toBe('system+latest-user-exceeds-budget')
    expect(plan.messages.some((item) => item.content === '当前这个问题')).toBe(true)
    expect(plan.droppedTurns).toBe(1)
    expect(plan.droppedMessages).toBe(2)
  })

  it('marks a missing window as a fallback budget instead of pretending it knows the model', () => {
    const plan = planAssistantContext({
      assistantPrompt: '你是助手。',
      branch: shortConversation,
      latestUserText: '帮我看一下这条消息'
    })

    expect(plan.budgetSource).toBe('fallback')
  })

  it('reserves room for the reply and keeps at least one turn', () => {
    expect(ASSISTANT_CONTEXT_RESERVE_FOR_REPLY_TOKENS).toBeGreaterThan(0)
    expect(ASSISTANT_CONTEXT_MIN_RECENT_TURNS).toBe(1)
  })
})
