export type OfficialMacroCalendarFixtureProvenance = {
  descriptorId: string
  canonicalUrl: string
  method: 'GET' | 'POST'
  requestTemplate: string
  capturedAt: string
  contentType: string
  status: number | 'transport-unavailable'
  sha256?: string
  payloadBytes: number
  fixtureFile?: string
  unavailableReason?: string
}

export const officialMacroCalendarFixtureProvenance: readonly OfficialMacroCalendarFixtureProvenance[] = [
  { descriptorId: 'macro-calendar-fed-schedule', canonicalUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', method: 'GET', requestTemplate: 'public-get', capturedAt: '2026-01-01T00:00:00.000Z', contentType: 'text/html', status: 200, sha256: 'dab1c3ff860e43c6b622b7bf41d98ad2c8586c79a9090096f5dc49a5b8940c77', payloadBytes: 1178, fixtureFile: 'fed-fomc-schedule-2026-08-03.html' },
  { descriptorId: 'macro-calendar-fed-statement', canonicalUrl: 'https://www.federalreserve.gov/feeds/press_all.xml', method: 'GET', requestTemplate: 'public-get', capturedAt: '2026-01-01T00:00:00.000Z', contentType: 'text/xml', status: 200, sha256: '2eebebb7511caa456595548e47c1a9c045ffcc347c140ff72852785d7746788b', payloadBytes: 808, fixtureFile: 'fed-press-feed-2026-08-03.xml' },
  { descriptorId: 'macro-calendar-bls-schedule', canonicalUrl: 'https://www.bls.gov/schedule/news_release/', method: 'GET', requestTemplate: 'public-get', capturedAt: '2026-08-03T13:54:19.000Z', contentType: 'text/html', status: 403, sha256: '0d66a719b43b2b2ce795ace0ee72234d1eb6b065362ec02be5b3d3fbc4877249', payloadBytes: 399, unavailableReason: 'official-endpoint-returned-403' },
  { descriptorId: 'macro-calendar-bls-values', canonicalUrl: 'https://api.bls.gov/publicAPI/v2/timeseries/data/', method: 'POST', requestTemplate: 'bls-public-series-2025-2026', capturedAt: '2026-08-03T13:54:34.000Z', contentType: 'unavailable', status: 'transport-unavailable', payloadBytes: 0, unavailableReason: 'transport-response-unavailable' },
  { descriptorId: 'macro-calendar-bea-schedule', canonicalUrl: 'https://www.bea.gov/news/schedule', method: 'GET', requestTemplate: 'public-get', capturedAt: '2026-01-01T00:00:00.000Z', contentType: 'text/html; charset=UTF-8', status: 200, sha256: 'a8ec56049b7852b779fee5c123ddd35f8a2a39ea8d48337228fcc1bfe2d9b57f', payloadBytes: 1356, fixtureFile: 'bea-release-schedule-2026-08-03.html' },
  { descriptorId: 'macro-calendar-bea-values', canonicalUrl: 'https://apps.bea.gov/api/data', method: 'GET', requestTemplate: 'public-no-credential-get', capturedAt: '2026-08-03T13:54:37.000Z', contentType: 'text/plain; charset=utf-8', status: 200, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', payloadBytes: 0, unavailableReason: 'credential-required-endpoint-returned-empty-body' }
]
