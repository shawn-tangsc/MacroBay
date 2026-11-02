import type { AgentRuntimeToolInvocation } from '@platform/ai/agent-platform/runtime/runtimeTypes'

import type { BriefingPriorConclusion, DailyBriefingDocument, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import { periodFactsFailure, type DailyBriefingPeriodFacts } from './dailyBriefingEditionSet'
import { validateDailyBriefingEditorial, type DailyBriefingValidation } from './dailyBriefingValidation'

export type { DailyBriefingPeriodFacts }

/**
 * The editorial validation plus the two facts rules of a period run.
 *
 * The writer is handed the run's rows and verdict; this is the one place that checks it did not
 * overrule the verdict or change the rows. Kept beside the validation rather than inside it so the
 * same rule applies to every caller of a writing pass, not just the one that remembered to ask.
 */
export function validateEditorialForPeriod(
  document: DailyBriefingDocument,
  raw: unknown,
  locale: DailyBriefingLocale,
  toolInvocations: readonly AgentRuntimeToolInvocation[] = [],
  priorConclusions: readonly BriefingPriorConclusion[] = [],
  facts?: DailyBriefingPeriodFacts
): DailyBriefingValidation {
  const validation = validateDailyBriefingEditorial(raw, document, locale, toolInvocations, priorConclusions)
  if (!validation.ok || !facts) return validation
  const failureCode = periodFactsFailure(document, facts, validation.value.conclusionSynthesis?.direction)
  return failureCode ? Object.freeze({ ok: false as const, failureCode }) : validation
}
