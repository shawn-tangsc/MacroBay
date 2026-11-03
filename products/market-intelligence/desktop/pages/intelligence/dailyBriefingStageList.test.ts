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
