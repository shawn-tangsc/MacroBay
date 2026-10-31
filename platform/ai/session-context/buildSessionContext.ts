import type {
  BuildSessionContextInput,
  SessionContextMessage,
  SessionContextPlan
} from './sessionContextTypes'
import { estimateTokens } from './tokenEstimate'

/** 模型没给窗口时的兜底值。**不允许**以「不知道窗口」为由不裁剪。 */
export const DEFAULT_CONTEXT_WINDOW = 8192

/** 保底轮仍超预算时，单条消息最少保留多少字符再继续截。 */
const MIN_TRUNCATABLE_CHARS = 24

type Turn = readonly SessionContextMessage[]

export function buildSessionContext(input: BuildSessionContextInput): SessionContextPlan {
  const contextWindow = input.budget.contextWindow ?? DEFAULT_CONTEXT_WINDOW
  const budgetSource = input.budget.contextWindow ? 'model' : 'fallback'
  const memoryBlocks = input.memoryBlocks ?? []
  const memoryText = memoryBlocks.map((block) => block.text).join('\n')
  const memoryTokens = memoryBlocks.reduce((sum, block) => sum + estimateTokens(block.text), 0)

  const systemTokens = estimateTokens(input.systemPrompt)
  const latestUser = input.history[input.history.length - 1]?.role === 'user'
    ? input.history[input.history.length - 1]
    : null
  const latestUserTokens = latestUser ? estimateTokens(renderMessage(latestUser)) : 0

  const fixedTokens = systemTokens + memoryTokens + latestUserTokens
  const availableForHistory = contextWindow - input.budget.reserveForReply - fixedTokens

  const turns = splitTurns(input.history)

  // system 与本次 user 本身就放不下：原样发送、history 全丢，并如实标 overflow。
  if (availableForHistory < 0) {
    const keptTurns = latestUser ? 1 : 0
    return {
      messages: assemble(input.systemPrompt, memoryText, latestUser ? [latestUser] : []),
      keptTurns,
      droppedTurns: turns.length - keptTurns,
      droppedMessages: input.history.length - (latestUser ? 1 : 0),
      truncatedMessages: 0,
      estimatedPromptTokens: fixedTokens,
      budgetSource,
      overflow: 'system+latest-user-exceeds-budget'
    }
  }

  const costs = turns.map((turn) => turnCost(turn, latestUser))
  let kept = 0
  let used = 0
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const cost = costs[index] ?? 0
    if (used + cost > availableForHistory) break
    used += cost
    kept += 1
  }

  // 保底轮优先于预算：不够就先留住，允许随后截断，而不是整轮丢掉。
  const minimum = Math.min(input.budget.minRecentTurns, turns.length)
  if (kept < minimum) {
    for (let index = turns.length - 1 - kept; index >= Math.max(0, turns.length - minimum); index -= 1) {
      used += costs[index] ?? 0
      kept += 1
    }
  }

  const keptTurns = dropLeadingAssistantTurns(turns.slice(turns.length - kept))
  const dropped = turns.slice(0, turns.length - keptTurns.length)

  const truncation = truncateToFit(keptTurns, latestUser, availableForHistory)
  const flat = [...truncation.turns.flat()]

  return {
    messages: assemble(input.systemPrompt, memoryText, flat),
    keptTurns: keptTurns.length,
    droppedTurns: dropped.length,
    droppedMessages: dropped.reduce((sum, turn) => sum + turn.length, 0),
    truncatedMessages: truncation.truncatedMessages,
    estimatedPromptTokens:
      fixedTokens + flat.reduce((sum, message) => sum + estimateTokens(renderMessage(message)), 0),
    budgetSource
  }
}

function splitTurns(history: readonly SessionContextMessage[]): Turn[] {
  const turns: SessionContextMessage[][] = []
  for (const message of history) {
    if (message.role === 'user') turns.push([message])
    else if (turns.length === 0) turns.push([message])
    else turns[turns.length - 1]?.push(message)
  }
  return turns
}

function turnCost(turn: Turn, latestUser: SessionContextMessage | null): number {
  return turn.reduce(
    (sum, message) => (message === latestUser ? sum : sum + estimateTokens(renderMessage(message))),
    0
  )
}

/** 丢弃后不得出现「首条是 assistant」。 */
function dropLeadingAssistantTurns(turns: readonly Turn[]): Turn[] {
  let start = 0
  while (start < turns.length) {
    const first = turns[start]?.[0]
    if (first && first.role === 'assistant') start += 1
    else break
  }
  return turns.slice(start)
}

function truncateToFit(
  turns: readonly Turn[],
  latestUser: SessionContextMessage | null,
  availableForHistory: number
): { turns: Turn[]; truncatedMessages: number } {
  const cost = turns.reduce((sum, turn) => sum + turnCost(turn, latestUser), 0)
  if (cost <= availableForHistory) return { turns: [...turns], truncatedMessages: 0 }

  const next = turns.map((turn) => [...turn])
  let truncated = 0
  let overflowTokens = cost - availableForHistory

  for (const turn of next) {
    for (const message of turn) {
      if (overflowTokens <= 0) break
      if (message === latestUser) continue
      if (message.text.length <= MIN_TRUNCATABLE_CHARS) continue
      const before = estimateTokens(renderMessage(message))
      const target = Math.max(
        MIN_TRUNCATABLE_CHARS,
        message.text.length - Math.ceil(overflowTokens * 2)
      )
      if (target >= message.text.length) continue
      const replacement = { ...message, text: `${message.text.slice(0, target)}…` }
      const after = estimateTokens(renderMessage(replacement))
      const index = turn.indexOf(message)
      if (index >= 0) {
        turn[index] = replacement
        overflowTokens -= before - after
        truncated += 1
      }
      if (truncated >= next.length) break
    }
  }

  return { turns: next, truncatedMessages: truncated }
}

function assemble(
  systemPrompt: string,
  memoryText: string,
  messages: readonly SessionContextMessage[]
): SessionContextPlan['messages'] {
  const assembled: SessionContextPlan['messages'] = []
  if (systemPrompt.trim()) assembled.push({ role: 'system', content: systemPrompt.trim() })
  if (memoryText.trim()) assembled.push({ role: 'system', content: memoryText.trim() })
  for (const message of messages) {
    const content = renderMessage(message)
    if (!content) continue
    assembled.push({ role: message.role, content })
  }
  return assembled
}

/** 非文本附件折叠成一行占位，而不是静默消失。 */
function renderMessage(message: SessionContextMessage): string {
  const attachments = (message.attachments ?? []).map(
    (attachment) => `<attachment kind="${attachment.kind}" label="${attachment.label}"/>`
  )
  return [message.text, ...attachments].filter((part) => part.length > 0).join('\n')
}
