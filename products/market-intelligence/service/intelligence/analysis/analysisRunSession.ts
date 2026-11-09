import type { CreateAgentSessionDto, CreateAgentSessionMessagesDto } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import { analysisWorkspacePolicy } from '../../../contracts/analysisWorkspaceContracts'

type SessionRef = { id: string; agentId: string | null; description?: string }

/**
 * One conversation per analysis run, so a reader can open the record of what was asked and answered.
 *
 * Built on the injected ports the follow-up conversation uses (`createAgentSession` /
 * `appendAgentSessionMessages`): one construction of "create a session" in the product, not two. The
 * agent is fixed — never "whatever is selected" — or the sidebar's automatic group would be scattered
 * across agents and never add up.
 *
 * Identity is `originRef` (the run id), read through a narrow lookup. `originGroup` groups (constant),
 * `originRef` identifies; the title is display only and may be renamed by the reader.
 *
 * Idempotent by `description`, so a restart or a re-run of the same run finds the existing session
 * instead of growing a second one. Only the run id goes into the conversation; the prompt and the
 * model's answer stay in `mi_analysis_io` and are read by that id, never copied here.
 */
export type AnalysisRunSessionDependencies = Readonly<{
  createAgentSession?: (input: CreateAgentSessionDto) => Promise<SessionRef>
  appendAgentSessionMessages?: (input: CreateAgentSessionMessagesDto) => Promise<unknown>
  /**
   * 「时刻 · 模块名」，按**建会话时**的读者时区与语言落成文本。
   *
   * 落成文本后不再随语言/时区变：历史会话是快照，和已发布结论保持发布时语言同一条规则。
   */
  /** 会话标题：只有模块名，不再依赖时刻（时刻在列表右侧、日期在分组标题上）。 */
  titleFor?: () => string | Promise<string>
  /**
   * 按 (agentId, originRef) 取一条，只读不建。
   *
   * 没有它就不建会话：`originRef` 是唯一的身份来源，读全量列表去重那条路已经删掉，
   * 在类型上也不可表达。
   */
  findAgentSessionByAutomationRef?: (agentId: string, originRef: string) => Promise<SessionRef | null>
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
    // 只有窄查这一条路。没有它就不建会话——**不退回「读全量列表去重」**：过渡路径一旦成为默认，
    // 2000 条会话时每次分析就要读 2000 行，而且没人记得它只是过渡。
    if (!deps.findAgentSessionByAutomationRef || !deps.createAgentSession) return undefined
    // 一条 SQL，与库里有多少条会话无关；标题改了也不影响身份（身份是 originRef）。
    const found = await deps.findAgentSessionByAutomationRef(analysisRunSessionPolicy.agentId, input.runId)
    if (found) return found.id
    // 描述只给人和老数据看；**身份是 originRef**，所以标题改了也不影响幂等。
    const description = `${analysisRunSessionPolicy.descriptionPrefix}${input.runId}`
    const session = await deps.createAgentSession({
      agentId: analysisRunSessionPolicy.agentId,
      // 标题是「时刻 · 模块名」，绝不是 run id：读者在助手列表里不该看到我们的账本编号。
      name: (deps.titleFor ? await deps.titleFor() : undefined)
        ?? analysisRunSessionPolicy.moduleName['zh-CN'],
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
              label: (deps.titleFor ? await deps.titleFor() : undefined)
                ?? analysisRunSessionPolicy.moduleName['zh-CN'],
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
    if (!deps.appendAgentSessionMessages || !deps.findAgentSessionByAutomationRef) return
    const session = await deps.findAgentSessionByAutomationRef(analysisRunSessionPolicy.agentId, input.runId)
    if (!session) return
    await deps.appendAgentSessionMessages({
      sessionId: session.id,
      messages: [{ role: 'assistant', data: { parts: [{ type: 'text', text: input.summary }] } }]
    })
  }
}

/**
 * 会话标题：**只有模块名**。
 *
 * 时刻与日期不再进标题。会话列表按「今天／昨天／更早」分组（日期在分组标题上），每一行右侧另有
 * `formatShellClock` 给出的时间——标题再印一遍就是同一事实的第二份，而标题里混数字＋`·` 也让
 * 中英混排看起来发挤（2026-11-09 的界面反馈）。
 *
 * 快照语义不变：落进名字里的文本按**建会话时**的语言，之后不随设置变；已经存成
 * 「时刻 · 模块名」的老会话保持原样——那是历史事实，不靠解析旧文本去改名。
 */
export function formatRunSessionTitle(language: keyof typeof analysisRunSessionPolicy.moduleName): string {
  return analysisRunSessionPolicy.moduleName[language]
}
