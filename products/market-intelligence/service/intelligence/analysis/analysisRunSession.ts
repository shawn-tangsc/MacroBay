import type { CreateAgentSessionDto, CreateAgentSessionMessagesDto } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import { analysisWorkspacePolicy } from '../../../contracts/analysisWorkspaceContracts'

type SessionRef = { id: string; agentId: string | null; description?: string }

/**
 * One conversation per analysis run, so a reader can open the record of what was asked and answered.
 *
 * Built on the same injected port the follow-up conversation uses (`getAgentState` /
 * `createAgentSession` / `appendAgentSessionMessages`): one construction of "create a session" in the
 * product, not two. The agent is fixed — never "whatever is selected" — or the sidebar's automatic
 * group would be scattered across agents and never add up.
 *
 * Idempotent by `description`, so a restart or a re-run of the same run finds the existing session
 * instead of growing a second one. Only the run id goes into the conversation; the prompt and the
 * model's answer stay in `mi_analysis_io` and are read by that id, never copied here.
 */
export type AnalysisRunSessionDependencies = Readonly<{
  getAgentState?: () => Promise<{ sessions: readonly SessionRef[] }>
  createAgentSession?: (input: CreateAgentSessionDto) => Promise<SessionRef>
  appendAgentSessionMessages?: (input: CreateAgentSessionMessagesDto) => Promise<unknown>
  /**
   * 「时刻 · 模块名」，按**建会话时**的读者时区与语言落成文本。
   *
   * 落成文本后不再随语言/时区变：历史会话是快照，和已发布结论保持发布时语言同一条规则。
   */
  titleFor?: (queuedAt: string) => string
}>

export const analysisRunSessionPolicy = Object.freeze({
  agentId: analysisWorkspacePolicy.agentId,
  descriptionPrefix: 'market-analysis-run:',
  origin: 'automation' as const,
  originGroup: 'market-analysis' as const,
  /** 模块名，按建会话时的语言取；不出现内部标识。 */
  moduleName: Object.freeze({ 'zh-CN': '市场分析', 'en-US': 'Market analysis' })
})

export function createAnalysisRunSession(deps: AnalysisRunSessionDependencies) {
  return async function ensureRunSession(input: Readonly<{
    runId: string
    /** When the run was queued: the moment the title names, not the moment we happened to look. */
    queuedAt?: string
    /** The one-line summary the card shows; absent while the run has not produced one. */
    summary?: string
  }>): Promise<string | undefined> {
    if (!deps.getAgentState || !deps.createAgentSession) return undefined
    const description = `${analysisRunSessionPolicy.descriptionPrefix}${input.runId}`
    const { sessions } = await deps.getAgentState()
    const existing = sessions.find(session =>
      session.agentId === analysisRunSessionPolicy.agentId && session.description === description)
    if (existing) return existing.id
    const session = await deps.createAgentSession({
      agentId: analysisRunSessionPolicy.agentId,
      // 标题是「时刻 · 模块名」，绝不是 run id：读者在助手列表里不该看到我们的账本编号。
      name: deps.titleFor?.(input.queuedAt ?? '') ?? analysisRunSessionPolicy.moduleName['zh-CN'],
      description,
      workspace: { type: 'system' },
      origin: analysisRunSessionPolicy.origin,
      // 两个字段各管一件事：`originGroup` 是侧栏分组的键（永远是 `market-analysis`，一天几十条
      // 也只占一块），`originRef` 是这一次运行的幂等键（只有它一个含义）。
      originGroup: analysisRunSessionPolicy.originGroup,
      originRef: input.runId
    } as CreateAgentSessionDto)
    // Two messages: the context card (which run this is) and the summary. Never the prompt or the
    // model's raw answer — those live once, in the archive, and are read by this run id.
    if (deps.appendAgentSessionMessages) {
      // 上下文卡片走 agent-context 部件：壳层把它画成卡片，标题来自文案键，payload 只带 runId。
      // 正文里不出现 `market-analysis-run:` 这种内部标识。
      const messages = [
        {
          role: 'system' as const,
          data: {
            parts: [{
              // 壳层把它画成一张卡片：`label` 是读者看的那一行（时刻 · 模块名），`kind` 是机器认的
              // 类型，`payload` 只带 runId——原始标识从不显示，也不会被当成正文念出来。
              type: 'agent-context' as const,
              kind: 'market-analysis-run',
              label: deps.titleFor?.(input.queuedAt ?? '') ?? analysisRunSessionPolicy.moduleName['zh-CN'],
              payload: { runId: input.runId }
            }]
          }
        },
        ...(input.summary ? [{ role: 'assistant' as const, data: { parts: [{ type: 'text' as const, text: input.summary }] } }] : [])
      ]
      try { await deps.appendAgentSessionMessages({ sessionId: session.id, messages }) } catch { /* 会话是记录的附加物 */ }
    }
    return session.id
  }
}

/**
 * Appends the published summary to the run's conversation.
 *
 * The conversation is created before the model is called, so a run that fails still has one; the
 * summary arrives only when a run publishes. Nothing else is appended: the prompt and the answer
 * live once, in the archive, and are read by run id.
 */
export function appendAnalysisRunSummary(deps: AnalysisRunSessionDependencies) {
  return async function appendRunSummary(input: Readonly<{ runId: string; summary: string }>): Promise<void> {
    if (!deps.getAgentState || !deps.appendAgentSessionMessages) return
    const description = `${analysisRunSessionPolicy.descriptionPrefix}${input.runId}`
    const { sessions } = await deps.getAgentState()
    const session = sessions.find(candidate =>
      candidate.agentId === analysisRunSessionPolicy.agentId && candidate.description === description)
    if (!session) return
    await deps.appendAgentSessionMessages({
      sessionId: session.id,
      messages: [{ role: 'assistant', data: { parts: [{ type: 'text', text: input.summary }] } }]
    })
  }
}

/**
 * 「时刻 · 模块名」：会话标题的唯一来源。
 *
 * 时刻按**建会话时**的读者时区格式化，模块名按当时的语言；落成文本后不再随设置变——历史会话
 * 是快照，和已发布结论保持发布时语言同一条规则。时间读不出来就不写时刻，绝不退回 run id。
 */
export function formatRunSessionTitle(
  queuedAt: string,
  language: keyof typeof analysisRunSessionPolicy.moduleName,
  timeZone: string
): string {
  const instant = new Date(queuedAt)
  const stamp = Number.isFinite(instant.getTime())
    ? new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short', timeZone }).format(instant)
    : ''
  const moduleName = analysisRunSessionPolicy.moduleName[language]
  return stamp ? `${stamp} · ${moduleName}` : moduleName
}
