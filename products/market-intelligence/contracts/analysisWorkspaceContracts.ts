/** 产品工作区身份规则：一个事件组复用一个普通会话，自动分析不创建会话。 */
export const analysisWorkspacePolicy = Object.freeze({
  productId: 'market-intelligence',
  agentId: 'crypto-market-analyst',
  sessionBindingPrefix: 'market-analysis-follow-up:',
  generalSessionBinding: 'market-analysis-conversation',
  errors: { unavailable: 'analysis-follow-up-unavailable' }
})

export type AnalysisWorkspaceBinding = Readonly<{
  agentId: string
  eventGroupId: string
  analysisRunId: string
  summaryId: string
  asOf: string
}>

export type AnalysisFollowUpInput = Readonly<{
  agentId: string
  eventGroupId: string
  analysisRunId: string
  existingSessionId?: string
}>

/**
 * What the panel has selected as the agent's conversation context.
 *
 * Kept separate from `AnalysisWorkspaceBinding`, which is a flat record the timeline, the
 * workspace, the session-purpose naming and the service binding path all consume — turning that
 * into a union would have touched every one of them. Selecting a calendar event is therefore its
 * own variant here rather than a new kind of binding.
 */
export type AgentConversationContext =
  | Readonly<{ kind: 'analysis-node'; binding: AnalysisWorkspaceBinding }>
  | Readonly<{
      kind: 'calendar-event'
      eventKey: string
      month: string
      /** The provider's own category, which the card colours. */
      category: 'economic-indicator' | 'financial-event' | 'central-bank-activity'
      scheduledAt: string | null
    }>

export const agentConversationContextPolicy = Object.freeze({
  version: 'marketIntelligenceAgentConversationContext.v1',
  /** One selection at a time: the marker in the panel names exactly one thing. */
  maximumSelectedContexts: 1
} as const)
