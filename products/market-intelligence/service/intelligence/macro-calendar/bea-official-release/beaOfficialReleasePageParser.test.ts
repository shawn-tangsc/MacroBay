import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import { parseBeaOfficialReleasePage } from './beaOfficialReleasePageParser'
import type { BeaOfficialReleaseRssIdentity, BeaReleaseGroup } from './beaOfficialReleaseRssRecognizer'

const pceGroup: BeaReleaseGroup = Object.freeze({ kind: 'pce-core', releaseGroupKey: 'US.BEA.PCE.2026-07', periodKey: '2026-07', scheduledDate: '2026-08-26', eventKeys: ['US.PCE.2026-07', 'US.CORE_PCE.2026-07'] })
const gdpGroup: BeaReleaseGroup = Object.freeze({ kind: 'gdp', releaseGroupKey: 'US.BEA.GDP.2026-Q2.SECOND', periodKey: '2026-Q2', variant: 'SECOND', scheduledDate: '2026-08-26', eventKeys: ['US.GDP.2026-Q2.SECOND'] })
const pio: BeaOfficialReleaseRssIdentity = Object.freeze({ title: 'Personal Income and Outlays, July 2026', officialPageUrl: 'https://www.bea.gov/news/2026/pio', publishedAt: '2026-08-26T12:30:00.000Z' })
const gdp: BeaOfficialReleaseRssIdentity = Object.freeze({ title: 'GDP (Second Estimate) and Corporate Profits, 2nd Quarter 2026', officialPageUrl: 'https://www.bea.gov/news/2026/gdp', publishedAt: '2026-08-26T12:30:00.000Z', currentPercent: 1.5 })
const gdpFixture = readFileSync(new URL('./fixtures/bea-gdp-second-q2-2026.html', import.meta.url), 'utf8')
const pioFixture = readFileSync(new URL('./fixtures/bea-pio-july-2026.html', import.meta.url), 'utf8')
function document(title: string, body: string): string { return `<html><head><title>${title} | U.S. Bureau of Economic Analysis (BEA)</title></head><body><h1>News Release</h1><h1>${title}</h1><h2>Technical Notes</h2><h3>Downloads</h3><div class="release-body">${body}</div></body></html>` }

describe('BEA official-release page parser', () => {
  it('reads only the two PCE year-over-year facts from the unique official release body', () => {
    const body = document(pio.title, '<p>Personal income increased 0.2 percent in July.</p><p>From the same month one year ago, the PCE price index for July increased 3.7 percent. Excluding food and energy, the PCE price index increased 3.3 percent from one year ago.</p>')
    expect(parseBeaOfficialReleasePage({ group: pceGroup, rss: pio, body })).toEqual({ pcePercent: 3.7, corePcePercent: 3.3 })
  })

  it('reads the exact GDP annual-rate fact only when it agrees with the RSS current value', () => {
    const body = document(gdp.title, '<p>Real gross domestic product (GDP) increased at an annual rate of 1.5 percent in the second quarter of 2026 (April, May, and June), according to the second estimate released today by the U.S. Bureau of Economic Analysis (BEA).</p>')
    expect(parseBeaOfficialReleasePage({ group: gdpGroup, rss: gdp, body })).toEqual({ gdpPercent: 1.5 })
  })

  it('reads Real GDP from the matched estimate column in the official table grammar', () => {
    const body = document(gdp.title, '<table><thead><tr><th colspan="3">Real GDP and Related Measures</th></tr><tr><th></th><th>Advance Estimate</th><th>Second Estimate</th></tr></thead><tbody><tr><th>Real GDP</th><td>1.4</td><td>1.5</td></tr></tbody></table>')
    expect(parseBeaOfficialReleasePage({ group: gdpGroup, rss: gdp, body })).toEqual({ gdpPercent: 1.5 })
  })

  it('parses cleaned official GDP and PIO page fixtures end to end', () => {
    expect(parseBeaOfficialReleasePage({ group: gdpGroup, rss: gdp, body: gdpFixture })).toEqual({ gdpPercent: 1.5 })
    expect(parseBeaOfficialReleasePage({ group: pceGroup, rss: pio, body: pioFixture })).toEqual({ pcePercent: 3.7, corePcePercent: 3.3 })
  })

  it('keeps the full PIO release body when nested divs precede the official year-over-year facts', () => {
    const body = document(pio.title, '<div class="center_div"><p>Chart</p></div><p>From the same month one year ago, the PCE price index for July increased 3.7 percent. Excluding food and energy, the PCE price index increased 3.3 percent from one year ago.</p>')
    expect(parseBeaOfficialReleasePage({ group: pceGroup, rss: pio, body })).toEqual({ pcePercent: 3.7, corePcePercent: 3.3 })
  })

  it('accepts only the finite whitespace introduced by official anchor boundaries before PIO sentence periods', () => {
    const body = document(pio.title, '<p><a>From the same month one year ago, the PCE price index for July increased 3.7 percent</a>. Excluding food and energy, the PCE price index increased 3.3 percent from one year ago.</p>')
    expect(parseBeaOfficialReleasePage({ group: pceGroup, rss: pio, body })).toEqual({ pcePercent: 3.7, corePcePercent: 3.3 })
  })

  it.each([
    ['generic title but absent release headline', '<html><title>Personal Income and Outlays, July 2026 | U.S. Bureau of Economic Analysis (BEA)</title><h1>News Release</h1><div class="release-body">From the same month one year ago, the PCE price index for July increased 3.7 percent. Excluding food and energy, the PCE price index increased 3.3 percent from one year ago.</div></html>', pceGroup, pio],
    ['monthly facts', document(pio.title, '<p>The PCE price index increased 0.2 percent. Excluding food and energy, it increased 0.3 percent.</p>'), pceGroup, pio],
    ['GDP RSS conflict', document(gdp.title, '<p>Real gross domestic product (GDP) increased at an annual rate of 1.6 percent in the second quarter of 2026 (April, May, and June), according to the second estimate released today by the U.S. Bureau of Economic Analysis (BEA).</p>'), gdpGroup, gdp]
  ])('fails closed for %s', (_label, body, group, rss) => {
    expect(parseBeaOfficialReleasePage({ group, rss, body })).toBeUndefined()
  })
})
