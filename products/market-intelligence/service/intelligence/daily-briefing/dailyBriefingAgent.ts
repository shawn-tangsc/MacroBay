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
      const messages = buildDailyBriefingPrompt({ document: input.document, locale: input.locale })
      let result: Awaited<ReturnType<typeof deps.invoke>>
      try {
        result = await deps.invoke({
          taskId: `daily-briefing:${input.document.edition.date}:${input.locale}`,
          messages,
          timeoutMs: 55_000,
          ...(input.providerId ? { providerId: input.providerId } : {}),
          ...(input.modelId ? { modelId: input.modelId } : {}),
          parse: (value) => value
        })
      } catch {
        return templateResult(input.document, 'provider-error')
      }
      if (!result.ok) return templateResult(input.document, result.errorCode)
      const parsed = parseEditorial(result.output)
      if (!parsed) return templateResult(input.document, 'invalid-json')
      const validation = validateDailyBriefingEditorial(parsed, input.document, input.locale)
      if (!validation.ok) return templateResult(input.document, validation.failureCode)
      return Object.freeze({
        document: applyDailyBriefingEditorial(input.document, validation.value, {
          promptVersion,
          model: result.modelId || input.modelId || 'unknown',
          source: input.source ?? 'default'
        }),
        state: 'agent' as const
      })
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

function templateResult(document: DailyBriefingDocument, failureCode: EditorialFailure): DailyBriefingAgentResult {
  return Object.freeze({ document, state: 'template' as const, failureCode })
}
