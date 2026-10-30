import type { DailyBriefingDocument, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import { buildDailyBriefingPrompt } from './dailyBriefingPrompt'
import { applyDailyBriefingEditorial, validateDailyBriefingEditorial } from './dailyBriefingValidation'
import type { DailyBriefAgentRunner } from './dailyBriefAgentRunner'
import { dailyBriefEditionKey } from './dailyBriefEditorSessionNaming'

export type DailyBriefAgentTurnResult =
  | Readonly<{ state: 'accepted'; document: DailyBriefingDocument; sessionId: string; toolInvocations: readonly import('@platform/ai/agent-platform/runtime/runtimeTypes').AgentRuntimeToolInvocation[] }>
  | Readonly<{ state: 'failed'; failureCode: string; failureDetail?: string; sessionId: string; toolInvocations: readonly import('@platform/ai/agent-platform/runtime/runtimeTypes').AgentRuntimeToolInvocation[] }>

export async function runDailyBriefAgentTurn(input: Readonly<{
  runner: DailyBriefAgentRunner
  document: DailyBriefingDocument
  locale: DailyBriefingLocale
  allowedTools?: readonly string[]
}>): Promise<DailyBriefAgentTurnResult> {
  const prompt = buildDailyBriefingPrompt({ document: input.document, locale: input.locale })
    .map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join('\n\n')
  const editionKey = dailyBriefEditionKey(input.document.edition.date, input.locale)
  const summary = factSummary(input.document)
  const started = await input.runner.start({ editionKey, date: input.document.edition.date, locale: input.locale, prompt, displayText: `${summary.detail}\n\n任务：从候选中决定展示项，并写导语、why 与焦点情景。`, context: summary, ...(input.allowedTools ? { allowedTools: input.allowedTools } : {}) })
  let response = started.assistantText
  const toolInvocations: import('@platform/ai/agent-platform/runtime/runtimeTypes').AgentRuntimeToolInvocation[] = [...started.toolInvocations]
  let failureCode = 'invalid-json'
  let failureDetail: string | undefined
  for (let attempt = 0; attempt < 3; attempt++) {
    let parsed: unknown
    try { parsed = JSON.parse(response.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')) } catch { parsed = undefined }
    if (parsed) {
      const validation = validateDailyBriefingEditorial(parsed, input.document, input.locale, toolInvocations)
      if (validation.ok) {
        const document = applyDailyBriefingEditorial(input.document, validation.value, { promptVersion: 'daily-briefing.agent.v1', model: 'agent-session', source: 'default' })
        await input.runner.finish(editionKey, 'accepted')
        return { state: 'accepted', document, sessionId: started.sessionId, toolInvocations }
      }
      failureCode = validation.failureCode
      failureDetail = validation.detail
    }
    if (attempt < 2) {
      const repair = await input.runner.continue(started.sessionId, `Your previous JSON failed validation: ${failureCode}${failureDetail ? ` (${failureDetail})` : ''}. Rewrite the full JSON using only facts from the prompt.`)
      response = repair.assistantText
      toolInvocations.push(...repair.toolInvocations)
    }
  }
  await input.runner.finish(editionKey, 'failed')
  return { state: 'failed', failureCode, ...(failureDetail ? { failureDetail } : {}), sessionId: started.sessionId, toolInvocations }
}

function factSummary(document: DailyBriefingDocument): Readonly<{ kind: string; label: string; detail: string }> {
  const macro = document.news.macro.map((item) => `${item.title}：实际 ${item.actual ?? '—'} / 预期 ${item.consensus ?? '未收录'} / 前值 ${item.previous ?? '—'}`)
  const news = document.news.items.map((item) => item.translatedTitle ?? item.title)
  const data = [...document.data.market, ...document.data.funds].map((row) => `${row.id} ${row.value?.number ?? '—'}`)
  const details = [
    `窗口 ${document.edition.windowStart} → ${document.edition.windowEnd}`,
    `宏观候选 ${macro.length}：${macro.join('；') || '无'}`,
    `舆情候选 ${news.length}：${news.join('；') || '无'}`,
    `数据：${data.join('；') || '无'}`,
    document.conclusion ? `结论：${document.conclusion.summary.slice(0, 160)}` : '结论：无'
  ].join('\n')
  return Object.freeze({ kind: 'daily-briefing-facts', label: '日报输入事实', detail: details.slice(0, 1600) })
}
