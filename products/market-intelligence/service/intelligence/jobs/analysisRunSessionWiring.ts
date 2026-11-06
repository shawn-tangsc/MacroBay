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
  input: Pick<SessionDependencies, 'findAgentSessionByAutomationRef' | 'createAgentSession' | 'appendAgentSessionMessages'> & Readonly<{
    /** 建会话那一刻的读者时区：标题落成文本后不再随设置变。 */
    timeZone: () => string
    /** 建会话那一刻的读者语言：同上，落成文本后不再变。 */
    language: () => Promise<'zh-CN' | 'en-US'>
  }>
): Readonly<{
  ensure: ReturnType<typeof createAnalysisRunSession>
  appendSummary: ReturnType<typeof appendAnalysisRunSummary>
}> {
  return Object.freeze({
    ensure: createAnalysisRunSession({
      // 身份只走窄查：没有它就不建会话，不退回「读全量列表去重」。
      findAgentSessionByAutomationRef: input.findAgentSessionByAutomationRef,
      createAgentSession: input.createAgentSession,
      appendAgentSessionMessages: input.appendAgentSessionMessages,
      // 「时刻 · 模块名」，按建会话时的读者时区与语言落成文本；之后不再随设置变。
      titleFor: async queuedAt => formatRunSessionTitle(queuedAt, await input.language(), input.timeZone())
    }),
    appendSummary: appendAnalysisRunSummary({
      findAgentSessionByAutomationRef: input.findAgentSessionByAutomationRef,
      appendAgentSessionMessages: input.appendAgentSessionMessages
    })
  })
}

/**
 * 组合根只交依赖与时钟：怎么建会话、标题怎么落成文本，都留在本文件里。
 *
 * 这样 `bootstrap.ts` 只多一行调用，而不再为一个端口的装配长出六行——它是只减不增的基线文件。
 */
export function createRunSessionPortFromDeps(
  deps: Pick<SessionDependencies, 'findAgentSessionByAutomationRef' | 'createAgentSession' | 'appendAgentSessionMessages'>,
  clock: Readonly<{ timeZone: () => string; language: () => Promise<'zh-CN' | 'en-US'> }>
): ReturnType<typeof createRunSessionPort> {
  return createRunSessionPort({ ...deps, timeZone: clock.timeZone, language: clock.language })
}
