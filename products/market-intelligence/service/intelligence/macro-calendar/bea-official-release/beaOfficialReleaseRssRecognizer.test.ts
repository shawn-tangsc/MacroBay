import { describe, expect, it } from 'vitest'

import { recognizeBeaOfficialReleaseRss, type BeaReleaseGroup } from './beaOfficialReleaseRssRecognizer'

const pce: BeaReleaseGroup = Object.freeze({ kind: 'pce-core', releaseGroupKey: 'US.BEA.PCE.2026-07', periodKey: '2026-07', scheduledDate: '2026-08-26', scheduledAt: '2026-08-26T12:30:00.000Z', eventKeys: ['US.PCE.2026-07', 'US.CORE_PCE.2026-07'] })
const second: BeaReleaseGroup = Object.freeze({ kind: 'gdp', releaseGroupKey: 'US.BEA.GDP.2026-Q2.SECOND', periodKey: '2026-Q2', variant: 'SECOND', scheduledDate: '2026-08-26', scheduledAt: '2026-08-26T12:30:00.000Z', eventKeys: ['US.GDP.2026-Q2.SECOND'] })
const advance: BeaReleaseGroup = Object.freeze({ ...second, releaseGroupKey: 'US.BEA.GDP.2026-Q2.ADVANCE', variant: 'ADVANCE', eventKeys: ['US.GDP.2026-Q2.ADVANCE'] })
const third: BeaReleaseGroup = Object.freeze({ ...second, releaseGroupKey: 'US.BEA.GDP.2026-Q2.THIRD', variant: 'THIRD', eventKeys: ['US.GDP.2026-Q2.THIRD'] })

function rss(item: string): string { return `<rss><channel>${item}</channel></rss>` }
function item(fields: string): string { return `<item>${fields}</item>` }
function pioItem(): string { return item('<title>Personal Income and Outlays, July 2026</title><link>www.bea.gov/news/2026/personal-income-and-outlays-july-2026</link><guid>www.bea.gov/news/2026/personal-income-and-outlays-july-2026</guid><pubDate>Wed, 26 Aug 2026 08:30:00 EDT</pubDate>') }
function gdpItem(): string { return item('<title>GDP (Second Estimate) and Corporate Profits, 2nd Quarter 2026</title><link>https://www.bea.gov/news/2026/gdp-second-estimate-and-corporate-profits-2nd-quarter-2026</link><guid>https://www.bea.gov/news/2026/gdp-second-estimate-and-corporate-profits-2nd-quarter-2026</guid><pubDate>Wed, 26 Aug 2026 08:30:00 EDT</pubDate><data><main><current><infoDate>Q2 2026</infoDate><percentChange>+1.5</percentChange></current><previous><infoDate>Q1 2026</infoDate><percentChange>+0.5</percentChange></previous></main></data><vintage>2nd</vintage>') }

describe('BEA official-release RSS identity recognizer', () => {
  it('recognizes only the exact PIO title and byte-equal scheme-less official link/guid', () => {
    expect(recognizeBeaOfficialReleaseRss({ group: pce, body: rss('<broken>' + pioItem()) })).toEqual({
      title: 'Personal Income and Outlays, July 2026', officialPageUrl: 'https://www.bea.gov/news/2026/personal-income-and-outlays-july-2026', publishedAt: '2026-08-26T12:30:00.000Z'
    })
  })

  it('recognizes exact GDP Second identity and only its adjacent-quarter RSS previous fact', () => {
    expect(recognizeBeaOfficialReleaseRss({ group: second, body: rss(gdpItem()) })).toEqual({
      title: 'GDP (Second Estimate) and Corporate Profits, 2nd Quarter 2026', officialPageUrl: 'https://www.bea.gov/news/2026/gdp-second-estimate-and-corporate-profits-2nd-quarter-2026', publishedAt: '2026-08-26T12:30:00.000Z', currentPercent: 1.5, previousPercent: 0.5
    })
  })

  it.each([
    ['mismatched link and guid', pioItem().replace('<guid>www', '<guid>https://www')],
    ['wrong title', pioItem().replace('July 2026', 'June 2026')],
    ['duplicate matching item', pioItem() + pioItem()],
    ['wrong GDP variant', gdpItem().replace('Second Estimate', 'Advance Estimate')],
    ['bad GDP current quarter', gdpItem().replace('Q2 2026', 'Q1 2026')],
    ['legacy colon GDP period', gdpItem().replace('Q2 2026', '2026:Q2')],
    ['missing Second vintage', gdpItem().replace('<vintage>2nd</vintage>', '')]
  ])('fails closed for %s', (_label, body) => {
    expect(recognizeBeaOfficialReleaseRss({ group: body.includes('Gross Domestic') ? second : pce, body: rss(body) })).toBeUndefined()
  })

  it('rejects non-EDT/EST publication dates and accepts the official GDP title grammar', () => {
    expect(recognizeBeaOfficialReleaseRss({ group: second, body: rss(gdpItem()) })).toEqual(expect.objectContaining({ title: 'GDP (Second Estimate) and Corporate Profits, 2nd Quarter 2026' }))
    expect(recognizeBeaOfficialReleaseRss({ group: second, body: rss(gdpItem().replace('08:30:00 EDT', '12:30:00 GMT')) })).toBeUndefined()
  })

  it('accepts only the official ordinal GDP vintages, with an absent vintage reserved for Advance', () => {
    const advanceItem = gdpItem().replace('GDP (Second Estimate) and Corporate Profits', 'GDP (Advance Estimate)').replace('<vintage>2nd</vintage>', '')
    const thirdItem = gdpItem().replace('GDP (Second Estimate) and Corporate Profits', 'GDP (Third Estimate)').replace('<vintage>2nd</vintage>', '<vintage>3rd</vintage>')
    expect(recognizeBeaOfficialReleaseRss({ group: advance, body: rss(advanceItem) })).toEqual(expect.objectContaining({ currentPercent: 1.5 }))
    expect(recognizeBeaOfficialReleaseRss({ group: third, body: rss(thirdItem) })).toEqual(expect.objectContaining({ currentPercent: 1.5 }))
  })

  it('requires GDP current and previous facts to live under data/main', () => {
    const outsideMain = gdpItem().replace('<data><main>', '<current>').replace('</main></data>', '</current>')
    expect(recognizeBeaOfficialReleaseRss({ group: second, body: rss(outsideMain) })).toBeUndefined()
  })
})
