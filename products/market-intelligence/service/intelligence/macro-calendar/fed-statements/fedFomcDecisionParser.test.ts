import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { getMacroCalendarOfficialSourceDescriptor } from '../macroCalendarOfficialSourceRegistry'
import { parseFedFomcSchedule } from '../parsers/fedFomcScheduleParser'
import { fedFomcDecisionFixtureProvenance } from './fedFomcDecisionProvenance'
import { parseFedFomcDecision, parseFedFomcDecisionDocument } from './fedFomcDecisionParser'

const body = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', fedFomcDecisionFixtureProvenance.fixtureFile))
const scheduleBody = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'fed-fomc-schedule-2026-08-03.html'), 'utf8')
const input = {
  body,
  officialStatementUrl: fedFomcDecisionFixtureProvenance.canonicalUrl,
  schedule: { eventKey: 'US.FOMC.2026-07-29', eventFamily: 'fomc', scheduledDate: '2026-07-29' }
}

describe('parseFedFomcDecision', () => {
  it.each(['raise', 'lower'] as const)('reads the explicit final range of a derived %s decision without inferring it from the change', (verb) => {
    const derived = body.toString('utf8').replaceAll(
      'maintain the target range for the federal funds rate at 3-1/2 to 3-3/4 percent',
      `${verb} the target range for the federal funds rate by 1/4 percentage point to 3-3/4 to 4 percent`
    )
    expect(parseFedFomcDecisionDocument({ body: Buffer.from(derived), officialStatementUrl: input.officialStatementUrl })?.targetRange)
      .toEqual({ lowerPercent: 3.75, upperPercent: 4, displayValue: '3-3/4 to 4 percent' })
    expect(parseFedFomcDecisionDocument({ body: Buffer.from(derived.replaceAll(' to 3-3/4 to 4 percent', '')), officialStatementUrl: input.officialStatementUrl })).toBeUndefined()
  })
  it.each(['duplicate', 'conflict', 'date', 'metadata-only', 'inverted', 'unsupported-fraction'] as const)('rejects derived raise evidence with %s defects', defect => {
    const sentence = 'The Committee decided to raise the target range for the federal funds rate by 1/4 percentage point to 3-3/4 to 4 percent,'
    let derived = body.toString('utf8').replaceAll('The Committee decided to maintain the target range for the federal funds rate at 3-1/2 to 3-3/4 percent,', sentence)
    if (defect === 'duplicate') derived = derived.replaceAll(sentence, `${sentence} ${sentence}`)
    if (defect === 'conflict') derived = derived.replaceAll(sentence, `${sentence} ${sentence.replace('3-3/4 to 4', '4 to 4-1/4')}`)
    if (defect === 'date') derived = derived.replaceAll('July 29, 2026', 'July 30, 2026')
    if (defect === 'metadata-only') derived = derived.replace(/(<div id="article">[\s\S]*?)The Committee decided to raise the target range for the federal funds rate by 1\/4 percentage point to 3-3\/4 to 4 percent,/, '$1The Committee decided to raise rates,')
    if (defect === 'inverted') derived = derived.replaceAll('3-3/4 to 4 percent', '4 to 3-3/4 percent')
    if (defect === 'unsupported-fraction') derived = derived.replaceAll('3-3/4 to 4 percent', '3-2/3 to 4 percent')
    expect(parseFedFomcDecisionDocument({ body: Buffer.from(derived), officialStatementUrl: input.officialStatementUrl })).toBeUndefined()
  })
  it('parses the real RSS-derived official FOMC decision body as current evidence only', () => {
    expect(parseFedFomcDecision(input)).toEqual({
      eventKey: 'US.FOMC.2026-07-29',
      decisionDate: '2026-07-29',
      releasedAt: '2026-07-29T18:00:00.000Z',
      targetRange: { lowerPercent: 3.5, upperPercent: 3.75, displayValue: '3-1/2 to 3-3/4 percent' }
    })
  })

  it('reads the vote tally and the dissent direction from the approval and voting sentences', () => {
    const withVote = body.toString('utf8')
      .replace('approved the following statement for release:', 'approved the following statement for release by a 10 – 2 vote:')
      .replace(
        'The Committee is continuing its policy of reducing its holdings of Treasury securities and agency debt.',
        'Voting against the monetary policy action were Lisa D. Cook and Beth M. Hammack, who preferred to raise the target range for the federal funds rate by 1/4 percentage point at this meeting.'
      )
    const document = parseFedFomcDecisionDocument({ body: Buffer.from(withVote), officialStatementUrl: input.officialStatementUrl })
    expect(document?.vote).toEqual({ for: 10, against: 2 })
    expect(document?.dissents).toEqual([
      { name: 'Lisa D. Cook', preferred: 'raise' },
      { name: 'Beth M. Hammack', preferred: 'raise' }
    ])
  })

  it('omits the vote and dissents when the statement does not state them', () => {
    const document = parseFedFomcDecisionDocument({ body, officialStatementUrl: input.officialStatementUrl })
    expect(document?.vote).toBeUndefined()
    expect(document?.dissents).toBeUndefined()
  })

  it('joins the real date-only 2026-07-29 FOMC schedule without inventing a schedule time', () => {
    const schedule = parseFedFomcSchedule({ body: scheduleBody, descriptor: getMacroCalendarOfficialSourceDescriptor('macro-calendar-fed-schedule')! })
      .find((event) => event.eventKey === input.schedule.eventKey)

    expect(schedule).toMatchObject(input.schedule)
    expect(schedule?.scheduledAt).toBeUndefined()
    expect(parseFedFomcDecision({ ...input, schedule: { eventKey: schedule!.eventKey, eventFamily: schedule!.eventFamily, scheduledDate: schedule!.scheduledDate } })).toBeDefined()
  })

  it.each([
    body.toString('utf8').replace('Board of Governors of the Federal Reserve System', 'Other publisher'),
    body.toString('utf8').replace('Federal Reserve issues FOMC statement', 'Federal Reserve issues a statement'),
    body.toString('utf8').replace('The Committee decided to maintain the target range for the federal funds rate at 3-1/2 to 3-3/4 percent', 'The Committee decided to maintain monetary policy'),
    body.toString('utf8').replace('at 3-1/2 to 3-3/4 percent, in support', 'at 3-1/2 to 3-3/4 percent, in support The Committee decided to maintain the target range for the federal funds rate at 3-1/2 to 3-3/4 percent, in support'),
    body.toString('utf8').replace('at 3-1/2 to 3-3/4 percent, in support', 'at 3-1/2 to 3-3/4 percent, in support The Committee decided to maintain the target range for the federal funds rate at 3-3/4 to 4 percent, in support'),
    body.toString('utf8').replace("The Committee is continuing its policy", "The Committee decided to make an unrelated policy determination. The Committee is continuing its policy"),
    body.toString('utf8').replace('July 29, 2026', 'July 30, 2026')
  ])('rejects a body with missing, duplicate, conflicting, or mismatched decision evidence', (mutated) => {
    expect(parseFedFomcDecision({ ...input, body: Buffer.from(mutated, 'utf8') })).toBeUndefined()
  })

  it.each([
    { ...input, officialStatementUrl: 'https://example.test/monetary20260729a.htm' },
    { ...input, officialStatementUrl: `${fedFomcDecisionFixtureProvenance.canonicalUrl}?source=rss` },
    { ...input, schedule: { eventKey: 'US.FOMC.2026-07-30', eventFamily: 'fomc', scheduledDate: '2026-07-30' } },
    { ...input, schedule: { eventKey: 'US.FOMC.2026-07-29', eventFamily: 'fomc', scheduledDate: '2026-07-29', scheduledAt: '2026-07-29T18:00:00.000Z' } },
    { body: 'not-raw-bytes', officialStatementUrl: fedFomcDecisionFixtureProvenance.canonicalUrl, schedule: input.schedule },
    new Proxy(input, { get() { throw new Error('hostile') } }),
    { ...input, extra: true }
  ])('fails closed for foreign, date-only-join-invalid, malformed, or hostile input', (value) => {
    expect(parseFedFomcDecision(value)).toBeUndefined()
  })

  it('rejects a semantically plausible body whose bytes do not match the accepted raw fixture', () => {
    const alteredRange = body.toString('utf8').replace('3-1/2 to 3-3/4 percent', '3-3/4 to 4 percent')

    expect(parseFedFomcDecision({ ...input, body: Buffer.from(alteredRange, 'utf8') })).toBeUndefined()
  })

  it('does not produce an actual/previous pair without an accepted prior RSS-derived decision body', () => {
    const parsed = parseFedFomcDecision(input)

    expect(parsed).toBeDefined()
    expect(parsed).not.toHaveProperty('actual')
    expect(parsed).not.toHaveProperty('previous')
  })
})
