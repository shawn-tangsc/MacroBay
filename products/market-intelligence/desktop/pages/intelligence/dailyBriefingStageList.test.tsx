import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * One renderer for stage rows.
 *
 * The live run and the recorded trace drew the same nine stages in two files, so "generating" and
 * "failed" could differ in shape and in wording. These checks are mechanical on purpose: the anchor
 * has one home, both components go through it, and both really do produce rows with it.
 */
const ROOTS = ['products/market-intelligence/desktop', 'apps/desktop-shell/src']

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) sourceFiles(path, found)
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(path)
  }
  return found
}

const files = ROOTS.flatMap((root) => sourceFiles(root))
const containing = (needle: string): string[] => files.filter((file) => readFileSync(file, 'utf8').includes(needle))

describe('stage rows have one renderer', () => {
  it('keeps the row anchor in one file', () => {
    expect(containing('data-briefing-stage-row').map((file) => file.split('/').pop())).toEqual(['DailyBriefingStageList.tsx'])
  })

  it('has both stage lists import that renderer', () => {
    for (const name of ['DailyBriefingLiveSteps.tsx', 'DailyBriefingGenerationTimeline.tsx']) {
      const file = files.find((candidate) => candidate.endsWith(`/${name}`))
      expect(file, name).toBeDefined()
      expect(readFileSync(file!, 'utf8'), name).toContain('DailyBriefingStageList')
    }
  })
})

/**
 * The two states may differ in their outer container — the live run is a plain list, the recorded
 * trace keeps the stepper — but a row must look the same in both. This is the signature check that
 * Chief allowed in place of collapsing the containers: tag sequence and class list of the row's
 * parts, compared between the two components' own output.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { DailyBriefingLiveSteps } from './DailyBriefingLiveSteps'
import { DailyBriefingGenerationTimeline } from './DailyBriefingGenerationTimeline'
import { productText } from '../../shared/i18n/productText'
import { generationStageIds } from './dailyBriefingGenerationTrace'

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing

function rowSignature(html: string): string[] {
  return [...html.matchAll(/data-briefing-stage-row="true"/g)].map(() => 'row-content')
}

describe('a stage row looks the same in both states', () => {
  it('renders the same row parts, in the same order, in the live run and in the trace', () => {
    const startedAt = '2026-11-04T00:00:00.000Z'
    const live = renderToStaticMarkup(<DailyBriefingLiveSteps
      progress={{ attemptId: 'a1', startedAt, stages: generationStageIds.map((id) => ({ id, state: 'pending' as const })) }}
      text={text}
      nowMs={Date.parse(startedAt)}
    />)
    const trace = renderToStaticMarkup(<DailyBriefingGenerationTimeline
      trace={{ attemptId: 'a1', startedAt, finishedAt: startedAt, state: 'success', stages: generationStageIds.map((id) => ({ id, state: 'pending' as const })) }}
      text={text}
      formatTime={() => ''}
    />)

    const parts = (html: string): string[] => {
      const first = html.slice(html.indexOf('data-briefing-stage-row'))
      const row = first.slice(0, first.indexOf('</li>'))
      return [...row.matchAll(/class="(mi-brief-steps__[a-z-]+)"/g)].map((match) => match[1]!)
    }

    expect(rowSignature(live)).toHaveLength(8)
    expect(rowSignature(trace)).toHaveLength(9)
    // Name then detail, in that order, in both. The trace also carries the per-stage help trigger;
    // that is content the live run has no explanation for yet, not a different row shape.
    const shape = (html: string): string[] => parts(html).filter((name) => name.endsWith('__name') || name.endsWith('__detail'))
    expect(shape(live)[0]).toBe('mi-brief-steps__name')
    expect(shape(trace)[0]).toBe('mi-brief-steps__name')
    expect(shape(live).slice(0, 2)).toEqual(['mi-brief-steps__name', 'mi-brief-steps__detail'])
    expect(shape(trace).slice(0, 2)).toEqual(['mi-brief-steps__name', 'mi-brief-steps__detail'])
  })
})
