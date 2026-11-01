export type SessionContextRole = 'system' | 'user' | 'assistant'

export type SessionContextAttachment = {
  kind: 'image' | 'web-search' | 'tool' | 'file'
  label: string
}

export type SessionContextMessage = {
  id: string
  role: SessionContextRole
  text: string
  attachments?: readonly SessionContextAttachment[]
}

export type SessionContextMemoryKind = 'user' | 'episodic' | 'rule'

export type SessionContextMemoryBlock = {
  kind: SessionContextMemoryKind
  text: string
  /** 产生这条记忆的来源标识（会话 ID / 规则 ID），用于追溯与撤销。 */
  sourceId: string
  /** 是否允许用户撤销；撤销后调用方不再传这一条。 */
  revocable: boolean
}

export type SessionContextBudget = {
  /** 模型声明的上下文窗口；缺失时走兜底并如实标注。 */
  contextWindow?: number
  /** 给输出预留的 token。 */
  reserveForReply: number
  /** 保底保留的最近轮数，优先于预算。 */
  minRecentTurns: number
}

export type SessionContextOverflow = 'system+latest-user-exceeds-budget'

export type SessionContextPlan = {
  messages: Array<{ role: SessionContextRole; content: string }>
  keptTurns: number
  droppedTurns: number
  droppedMessages: number
  truncatedMessages: number
  estimatedPromptTokens: number
  budgetSource: 'model' | 'fallback'
  overflow?: SessionContextOverflow
}

export type BuildSessionContextInput = {
  systemPrompt: string
  /** 时间升序；最后一条是本次 user 消息。 */
  history: readonly SessionContextMessage[]
  budget: SessionContextBudget
  memoryBlocks?: readonly SessionContextMemoryBlock[]
}
