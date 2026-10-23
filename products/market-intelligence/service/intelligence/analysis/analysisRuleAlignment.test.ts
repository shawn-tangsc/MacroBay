import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { EvidenceSnapshot } from '../../../contracts/marketAnalysisContracts'
import { buildAnalysisMessages } from './analysisModelPrompt'
import {
  MARKET_ANALYSIS_SHARED_RULES_MARKERS,
  marketAnalysisSharedRules,
  renderSharedRulesBlock
} from './analysisSharedRules'

const skillPath = fileURLToPath(new URL('../../../agents/skills/market-analysis/SKILL.md', import.meta.url))

const asOf = '2026-10-07T09:06:14.792Z'

function snapshot(): EvidenceSnapshot {
  return {
    id: 'mi-es-1', schemaVersion: 1, eventGroupId: 'mi-eg-1', asOf, dataCutoff: asOf, snapshotHash: 'h1',
    profileId: 'crypto-market-analysis-v1', facts: [], missingDomains: [], caveats: [], evidenceRefs: [],
    sourceHealth: [], createdAt: asOf, policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1'
  } as EvidenceSnapshot
}

function systemPrompt(): string {
  return buildAnalysisMessages(snapshot()).find(message => message.role === 'system')!.content
}

/** The block the skill file carries between its markers, exactly as written. */
async function skillBlock(): Promise<string> {
  const markdown = await readFile(skillPath, 'utf8')
  const start = markdown.indexOf(MARKET_ANALYSIS_SHARED_RULES_MARKERS.start)
  const end = markdown.indexOf(MARKET_ANALYSIS_SHARED_RULES_MARKERS.end)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return markdown.slice(start + MARKET_ANALYSIS_SHARED_RULES_MARKERS.start.length, end).trim()
}

/**
 * The panel's analysis and the agent's follow-up read two different documents. They must not
 * disagree about what a judgement may rely on, what it may not do with a gap, or what it may say
 * about a position — the reader believes both come from the same analyst.
 */
describe('market analysis shared rules', () => {
  it('states every shared rule in the automatic analysis prompt', () => {
    const system = systemPrompt()

    expect(system).toContain(renderSharedRulesBlock())
    for (const rule of marketAnalysisSharedRules) expect(system, rule.id).toContain(rule.text)
  })

  it('keeps the skill file a verbatim copy of the same declaration', async () => {
    // Exact equality, not "contains": a rule edited on one side only is what this test exists for.
    expect(await skillBlock()).toBe(renderSharedRulesBlock())
  })

  it('keeps the declaration free of duplicate or empty rules', () => {
    const ids = marketAnalysisSharedRules.map(rule => rule.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const rule of marketAnalysisSharedRules) expect(rule.text.trim()).not.toBe('')
  })
})
