import type { StructuredModelInvocationService } from '@platform/ai/invocation/structuredModelInvocation'
import type { StructuredModelInvocationErrorCode } from '@platform/ai/invocation/structuredModelInvocationTypes'

import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { buildDailyBriefingPrompt, dailyBriefingPromptVersion } from './dailyBriefingPrompt'
import {
  applyDailyBriefingEditorial,
  validateDailyBriefingEditorial,
  type DailyBriefingValidationFailure
} from './dailyBriefingValidation'

type EditorialFailure = StructuredModelInvocationErrorCode | 'invalid-json' | DailyBriefingValidationFailure

export type DailyBriefingAgentResult = Readonly<{
  document: DailyBriefingDocument
  state: 'agent' | 'template'
  failureCode?: EditorialFailure
  failureDetail?: string
}>

export type DailyBriefingAgent = Readonly<{
  generate: (input: Readonly<{
    document: DailyBriefingDocument
    locale: 'zh-CN' | 'en-US'
    providerId?: string
    modelId?: string
    source?: 'default' | 'custom'
  }>) => Promise<DailyBriefingAgentResult>
}>

/**
 * One model call over the frozen document. Any failure returns the template document unchanged:
 * the R1 fact layer is the floor, and there is no half-edited edition.
 */
export function createDailyBriefingAgent(deps: Readonly<{
  invoke: StructuredModelInvocationService['invoke']
  promptVersion?: string
}>): DailyBriefingAgent {
  return {
    async generate(input) {
      const promptVersion = deps.promptVersion ?? dailyBriefingPromptVersion
      let messages = buildDailyBriefingPrompt({ document: input.document, locale: input.locale })
      let lastFailure: EditorialFailure | undefined
      let lastDetail: string | undefined
      for (let attempt = 0; attempt < 3; attempt++) {
        let result: Awaited<ReturnType<typeof deps.invoke>>
        try {
          result = await deps.invoke({
            taskId: `daily-briefing:${input.document.edition.date}:${input.locale}:${attempt}`,
            messages,
            timeoutMs: 40_000,
            ...(input.providerId ? { providerId: input.providerId } : {}),
            ...(input.modelId ? { modelId: input.modelId } : {}),
            parse: (value) => value
          })
        } catch {
          return templateResult(input.document, 'provider-error')
        }
        if (!result.ok) return templateResult(input.document, result.errorCode)
        const raw = typeof result.output === 'string' ? result.output : JSON.stringify(result.output)
        const parsed = parseEditorial(result.output)
        if (!parsed) {
          lastFailure = 'invalid-json'
          lastDetail = 'the response was not a JSON object'
        } else {
          const validation = validateDailyBriefingEditorial(parsed, input.document, input.locale)
          if (validation.ok) {
            return Object.freeze({
              document: applyDailyBriefingEditorial(input.document, validation.value, {
                promptVersion,
                model: result.modelId || input.modelId || 'unknown',
                source: input.source ?? 'default'
              }),
              state: 'agent' as const
            })
          }
          lastFailure = validation.failureCode
          lastDetail = validation.detail
        }
        if (attempt < 2) {
          messages = [
            ...messages,
            { role: 'assistant' as const, content: raw },
            {
              role: 'user' as const,
              content: [
                `Your previous JSON failed validation: ${lastFailure}${lastDetail ? ` (${lastDetail})` : ''}.`,
                'Rewrite the complete JSON now. Keep the same fact ids, remove the offending value, and use only numbers that appear verbatim in FACTS. Do not give trade advice, price targets, URLs or new facts.'
              ].join(' ')
            }
          ]
        }
      }
      return templateResult(input.document, lastFailure ?? 'invalid-json', lastDetail)
    }
  }
}

function parseEditorial(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  try {
    return JSON.parse(text) as unknown
  } catch {
    // Some compatible endpoints add one sentence before the object, or keep a trailing fence.
    // Recover the first complete object rather than treating a valid answer as a parse failure.
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) return undefined
    try {
      return JSON.parse(text.slice(start, end + 1)) as unknown
    } catch {
      return undefined
    }
  }
}

function templateResult(document: DailyBriefingDocument, failureCode: EditorialFailure, failureDetail?: string): DailyBriefingAgentResult {
  return Object.freeze({ document, state: 'template' as const, failureCode, ...(failureDetail ? { failureDetail } : {}) })
}
