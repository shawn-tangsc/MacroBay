import { describe, expect, it } from 'vitest'

import { parsePolicyPathSep } from './policyPathSepParser'

const table = `
<table>
<tr><th>Variable</th><th>2026</th><th>2027</th><th>2028</th><th>2029</th><th>Longer run</th><th>2026</th><th>2027</th><th>2028</th><th>2029</th><th>Longer run</th><th>2026</th><th>2027</th><th>2028</th><th>2029</th><th>Longer run</th></tr>
<tr><td>Change in real GDP</td><td>2.3</td><td>2.4</td><td>2.2</td><td>2.1</td><td>2.0</td><td>2.2–2.4</td><td>2.2–2.6</td><td>2.1–2.3</td><td>2.0–2.2</td><td>2.0–2.2</td><td>2.1–2.6</td><td>2.0–2.9</td><td>1.8–2.6</td><td>1.8–2.4</td><td>1.7–2.5</td></tr>
<tr><td><strong>Memo:</strong> Projected appropriate policy path</td></tr>
<tr><td><strong>Federal funds rate</strong></td><td><strong>4.1</strong></td><td>4.1</td><td>3.9</td><td>3.6</td><td>3.2</td><td>4.1–4.4</td><td>3.6–4.4</td><td>3.1–4.1</td><td>3.1–3.6</td><td>3.0–3.6</td><td>3.9–4.4</td><td>3.1–4.4</td><td>3.1–4.1</td><td>2.9–3.9</td><td>2.9–3.9</td></tr>
<tr><td>June projection</td><td>3.8</td><td>3.6</td><td>3.4</td><td>—</td><td>3.1</td><td>3.6–4.1</td><td>3.1–3.9</td><td>3.1–3.6</td><td>—</td><td>3.0–3.5</td><td>3.4–4.4</td><td>2.9–4.4</td><td>2.9–3.9</td><td>—</td><td>2.9–3.9</td></tr>
</table>`

const url = 'https://www.federalreserve.gov/monetarypolicy/fomcprojtabl20260916.htm'

describe('policy path SEP parser', () => {
  it('reads the medians, the current-year range and the previous median', () => {
    expect(parsePolicyPathSep({ body: table, sourceUrl: url })).toEqual({
      asOf: '2026-09-16',
      medianPath: { y2026: 4.1, y2027: 4.1, y2028: 3.9, y2029: 3.6, longerRun: 3.2 },
      rangeCurrentYear: { low: 3.9, high: 4.4 },
      previousMedian: 3.8,
      sourceUrl: url
    })
  })

  it('refuses a body without the policy row and a URL that is not a projection table', () => {
    expect(parsePolicyPathSep({ body: '<table><tr><td>GDP</td></tr></table>', sourceUrl: url })).toBeUndefined()
    expect(parsePolicyPathSep({ body: table, sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm' })).toBeUndefined()
  })

  it('tolerates a missing previous-quarter row instead of inventing one', () => {
    const withoutPrevious = table.replace(/<tr><td>June projection[\s\S]*?<\/tr>/, '')
    const parsed = parsePolicyPathSep({ body: withoutPrevious, sourceUrl: url })!
    expect(parsed.previousMedian).toBeUndefined()
    expect(parsed.medianPath.y2026).toBe(4.1)
  })
})
