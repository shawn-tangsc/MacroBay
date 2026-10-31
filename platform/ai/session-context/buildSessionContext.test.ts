import { describe, expect, it } from 'vitest'

import { buildSessionContext, DEFAULT_CONTEXT_WINDOW } from './buildSessionContext'
import type { SessionContextMessage, SessionContextPlan } from './sessionContextTypes'

function user(id: string, text: string, extra: Partial<SessionContextMessage> = {}): SessionContextMessage {
  return { id, role: 'user', text, ...extra }
}

function assistant(id: string, text: string): SessionContextMessage {
  return { id, role: 'assistant', text }
}

function system(id: string, text: string): SessionContextMessage {
  return { id, role: 'system', text }
}

function build(history: SessionContextMessage[], overrides: Partial<Parameters<typeof buildSessionContext>[0]['budget']> = {}, systemPrompt = ''): SessionContextPlan {
  return buildSessionContext({
    systemPrompt,
    history,
    budget: { contextWindow: 1000, reserveForReply: 100, minRecentTurns: 1, ...overrides }
  })
}

const conversation: SessionContextMessage[] = [
  user('u1', 'first question'),
  assistant('a1', 'first answer'),
  user('u2', 'second question'),
  assistant('a2', 'second answer'),
  user('u3', 'third question')
]

describe('buildSessionContext', () => {
  it('keeps everything when the budget is generous', () => {
    const plan = build(conversation, { contextWindow: 100_000 })

    expect(plan.droppedTurns).toBe(0)
    expect(plan.keptTurns).toBe(3)
    expect(plan.messages.at(-1)).toEqual({ role: 'user', content: 'third question' })
  })

  it('drops whole turns from the oldest when the budget is tight', () => {
    const plan = build(conversation, { contextWindow: 60, reserveForReply: 40, minRecentTurns: 1 })

    expect(plan.droppedTurns).toBeGreaterThan(0)
    expect(plan.keptTurns + plan.droppedTurns).toBe(3)
    expect(plan.messages.at(-1)).toEqual({ role: 'user', content: 'third question' })
  })

  it('never leaves an assistant message without the user it answers', () => {
    const plan = build(conversation, { contextWindow: 260, reserveForReply: 50, minRecentTurns: 1 })
    const roles = plan.messages.map((message) => message.role)

    expect(roles[roles.length - 1]).toBe('user')
    if (roles[0] !== 'system') expect(roles[0]).toBe('user')
  })

  it('honours minRecentTurns over the budget and reports truncation instead', () => {
    const longHistory: SessionContextMessage[] = []
    for (let index = 0; index < 6; index += 1) {
      longHistory.push(user(`u${index}`, 'x'.repeat(200)))
      longHistory.push(assistant(`a${index}`, 'y'.repeat(200)))
    }
    longHistory.push(user('last', 'closing question'))

    const plan = build(longHistory, { contextWindow: 400, reserveForReply: 100, minRecentTurns: 4 })

    expect(plan.keptTurns).toBeGreaterThanOrEqual(4)
    expect(plan.truncatedMessages).toBeGreaterThan(0)
  })

  it('keeps a system message with its turn instead of hoisting it', () => {
    const history = [user('u1', 'hi'), system('s1', 'stay in chinese'), assistant('a1', 'ok')]
    const plan = build(history, { contextWindow: 100_000 })

    expect(plan.messages.map((message) => message.content)).toEqual(['hi', 'stay in chinese', 'ok'])
  })

  it('marks the fallback source when the model window is unknown', () => {
    const plan = buildSessionContext({
      systemPrompt: 'be brief',
      history: conversation,
      budget: { reserveForReply: 100, minRecentTurns: 1 }
    })

    expect(plan.budgetSource).toBe('fallback')
    expect(DEFAULT_CONTEXT_WINDOW).toBe(8192)
  })

  it('sends system and the latest user as-is when even those do not fit', () => {
    const plan = build(conversation, { contextWindow: 50, reserveForReply: 40, minRecentTurns: 1 }, 'x'.repeat(100))

    expect(plan.overflow).toBe('system+latest-user-exceeds-budget')
    expect(plan.messages).toHaveLength(2)
    expect(plan.messages[0]?.content).toBe('x'.repeat(100))
    expect(plan.messages[1]?.content).toBe('third question')
    expect(plan.droppedTurns).toBe(2)
  })

  it('folds attachments into a placeholder line instead of dropping them silently', () => {
    const plan = build(
      [user('u1', 'what is in this image', { attachments: [{ kind: 'image', label: '图片' }] })],
      { contextWindow: 100_000 }
    )

    expect(plan.messages[0]?.content).toContain('<attachment kind="image" label="图片"/>')
  })

  it('emits only the system prompt for an empty history', () => {
    const plan = build([], {}, 'be brief')

    expect(plan.messages).toEqual([{ role: 'system', content: 'be brief' }])
    expect(plan.droppedTurns).toBe(0)
  })

  it('places memory blocks between the system prompt and history', () => {
    const plan = buildSessionContext({
      systemPrompt: 'be brief',
      history: [user('u1', 'hi')],
      budget: { contextWindow: 100_000, reserveForReply: 100, minRecentTurns: 1 },
      memoryBlocks: [{ kind: 'user', text: 'prefers Chinese', sourceId: 'profile', revocable: true }]
    })

    expect(plan.messages.map((message) => message.content)).toEqual(['be brief', 'prefers Chinese', 'hi'])
  })
})
