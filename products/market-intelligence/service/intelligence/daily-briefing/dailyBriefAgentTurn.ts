import type { DailyBriefingDocument, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import { buildDailyBriefingPrompt } from './dailyBriefingPrompt'
import { applyDailyBriefingEditorial, validateDailyBriefingEditorial } from './dailyBriefingValidation'
import type { DailyBriefAgentRunner } from './dailyBriefAgentRunner'
import { dailyBriefEditionKey } from './dailyBriefEditorSessionNaming'

export type DailyBriefAgentTurnResult =
  | Readonly<{ state: 'accepted'; document: DailyBriefingDocument; sessionId: string }>
  | Readonly<{ state: 'failed'; failureCode: string; failureDetail?: string; sessionId: string }>

export async function runDailyBriefAgentTurn(input: Readonly<{
  runner: DailyBriefAgentRunner
  document: DailyBriefingDocument
  locale: DailyBriefingLocale
}>): Promise<DailyBriefAgentTurnResult> {
  const prompt = buildDailyBriefingPrompt({ document: input.document, locale: input.locale })
    .map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join('\n\n')
  const editionKey = dailyBriefEditionKey(input.document.edition.date, input.locale)
  const started = await input.runner.start({ editionKey, date: input.document.edition.date, locale: input.locale, prompt })
  let response = started.assistantText
  let failureCode = 'invalid-json'
  let failureDetail: string | undefined
  for (let attempt = 0; attempt < 3; attempt++) {
    let parsed: unknown
    try { parsed = JSON.parse(response.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')) } catch { parsed = undefined }
    if (parsed) {
      const validation = validateDailyBriefingEditorial(parsed, input.document, input.locale)
      if (validation.ok) {
        const document = applyDailyBriefingEditorial(input.document, validation.value, { promptVersion: 'daily-briefing.agent.v1', model: 'agent-session', source: 'default' })
        await input.runner.finish(editionKey, 'accepted')
        return { state: 'accepted', document, sessionId: started.sessionId }
      }
      failureCode = validation.failureCode
      failureDetail = validation.detail
    }
    if (attempt < 2) response = await input.runner.continue(started.sessionId, `Your previous JSON failed validation: ${failureCode}${failureDetail ? ` (${failureDetail})` : ''}. Rewrite the full JSON using only facts from the prompt.`)
  }
  await input.runner.finish(editionKey, 'failed')
  return { state: 'failed', failureCode, ...(failureDetail ? { failureDetail } : {}), sessionId: started.sessionId }
}
