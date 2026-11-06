import { appendAnalysisRunSummary, createAnalysisRunSession, formatRunSessionTitle } from '../analysis/analysisRunSession'

type SessionDependencies = Parameters<typeof createAnalysisRunSession>[0]

/**
 * 自动分析会话的端口装配。
 *
 * 与追问会话共用同一份注入端口，不另造第二个建会话的地方：建在固定智能体下、按 runId 幂等，
 * 会话里只放 runId 与摘要，原文留在 `mi_analysis_io`。
 *
 * 单独成文件是为了让组合根只留一行调用——`bootstrap.ts` 是只减不增的基线文件，而「怎么建会话」
 * 本身不是装配顺序的一部分。
 */
export function createRunSessionPort(
  input: Pick<SessionDependencies, 'getAgentState' | 'createAgentSession' | 'appendAgentSessionMessages'> & Readonly<{
    /** 建会话那一刻的读者时区：标题落成文本后不再随设置变。 */
    timeZone: () => string
  }>
): Readonly<{
  ensure: ReturnType<typeof createAnalysisRunSession>
  appendSummary: ReturnType<typeof appendAnalysisRunSummary>
}> {
  return Object.freeze({
    ensure: createAnalysisRunSession({
      getAgentState: input.getAgentState,
      createAgentSession: input.createAgentSession,
      appendAgentSessionMessages: input.appendAgentSessionMessages,
      // 「时刻 · 模块名」，按建会话时的读者时区与语言落成文本；之后不再随设置变。
      titleFor: queuedAt => formatRunSessionTitle(queuedAt, 'zh-CN', input.timeZone())
    }),
    appendSummary: appendAnalysisRunSummary({
      getAgentState: input.getAgentState,
      appendAgentSessionMessages: input.appendAgentSessionMessages
    })
  })
}
