export const blsObservationFixtureProvenance = {
  canonicalUrl: 'https://api.bls.gov/publicAPI/v2/timeseries/data/',
  method: 'POST' as const,
  requestTemplate: 'bls-six-public-series-2025-2026',
  capturedAt: '2026-08-03T15:17:36.000Z',
  contentType: 'application/json',
  status: 200,
  sha256: '55b4fc30a103632cfc117bc131576a61006098a2eea5c900c52791ea792aa705',
  payloadBytes: 10_327,
  fixtureFile: 'bls-six-series-2025-2026-2026-08-03.json'
} as const
