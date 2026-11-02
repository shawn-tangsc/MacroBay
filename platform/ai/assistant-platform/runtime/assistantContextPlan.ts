import {
  buildSessionContext,
  type SessionContextMessage,
  type SessionContextPlan
} from '../../session-context'
import { extractAssistantSearchableText, type AssistantMessageEntity } from '../schemas/messageSchemas'
import type { ChatCompletionMessage } from './assistantOpenAiStreamClient'

/**
 * 助手会话上下文的唯一组装口。
 *
 * 之前这里没有上限：整条活跃分支原样发出去，靠的是「用户不会聊太久」这个假设。
 * 现在改成按 token 预算裁剪，规则全部在 `platform/ai/session-context`，这里只做两件事：
 * 把消息映射成上下文契约的形状，再把裁剪结果映射回请求体。
 */

/** 给回复预留的 token。裁剪必须先扣掉它，否则请求会在服务端被截断。 */
export const ASSISTANT_CONTEXT_RESERVE_FOR_REPLY_TOKENS = 1024

/** 无论预算多紧，至少保留最近一轮（当前提问永远不能被丢掉）。 */
export const ASSISTANT_CONTEXT_MIN_RECENT_TURNS = 1

export type AssistantContextPlanInput = {
  assistantPrompt: string
  /** 活跃分支上的消息，时间升序；调用方已排除占位消息与非成功消息。 */
  branch: readonly AssistantMessageEntity[]
  /** 本次用户输入。若分支末尾已经是它，就不会重复追加。 */
  latestUserText: string
  /** 模型声明的上下文窗口；缺失时由契约回落到保守值并标记来源。 */
  contextWindow?: number
}

export function planAssistantContext(input: AssistantContextPlanInput): SessionContextPlan {
  const history: SessionContextMessage[] = []
  for (const message of input.branch) {
    const text = extractAssistantSearchableText(message.data)
    if (!text) continue
    history.push({ id: message.id, role: message.role, text })
  }

  const last = history[history.length - 1]
  if (last?.role !== 'user' || last.text !== input.latestUserText) {
    history.push({ id: 'latest-user', role: 'user', text: input.latestUserText })
  }

  return buildSessionContext({
    systemPrompt: input.assistantPrompt,
    history,
    budget: {
      ...(input.contextWindow ? { contextWindow: input.contextWindow } : {}),
      reserveForReply: ASSISTANT_CONTEXT_RESERVE_FOR_REPLY_TOKENS,
      minRecentTurns: ASSISTANT_CONTEXT_MIN_RECENT_TURNS
    }
  })
}

/** 一次会话发出去多少、丢了多少：这是 `budgetSource` 的真实出口，不许只活在字段里。 */
export type AssistantContextPlanSummary = {
  keptTurns: number
  droppedTurns: number
  droppedMessages: number
  truncatedMessages: number
  estimatedPromptTokens: number
  budgetSource: 'model' | 'fallback'
  contextWindow?: number
}

export function summarizeAssistantContext(
  plan: SessionContextPlan,
  contextWindow?: number
): AssistantContextPlanSummary {
  return {
    keptTurns: plan.keptTurns,
    droppedTurns: plan.droppedTurns,
    droppedMessages: plan.droppedMessages,
    truncatedMessages: plan.truncatedMessages,
    estimatedPromptTokens: plan.estimatedPromptTokens,
    budgetSource: plan.budgetSource,
    ...(contextWindow ? { contextWindow } : {})
  }
}

export function toChatCompletionMessages(plan: SessionContextPlan): ChatCompletionMessage[] {
  return plan.messages.map((message) => ({ role: message.role, content: message.content }))
}
