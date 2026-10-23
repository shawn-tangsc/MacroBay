import type { ReactNode } from 'react'

import type { AgentContextMessagePart } from '@platform/ai/agent-platform/schemas/sessionSchemas'

/**
 * Product-owned rendering for a readable message context. The platform stores and transports the
 * context; a host decides what a `kind` looks like by supplying a renderer map. Returning null
 * falls back to the neutral platform card.
 */
export type AgentContextRenderer = (input: { part: AgentContextMessagePart }) => ReactNode | null

export type AgentContextRendererRegistry = Readonly<Record<string, AgentContextRenderer>>
