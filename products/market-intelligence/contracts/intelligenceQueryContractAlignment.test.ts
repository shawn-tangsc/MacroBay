import { describe, expect, it } from 'vitest'

import * as publicContracts from './intelligenceQueryContracts'
import * as serviceShim from '../service/intelligence/public-query/queryContracts'

describe('market intelligence public query contracts', () => {
  it('keeps the service shim aligned with the public contract module', () => {
    expect(serviceShim.MARKET_INTELLIGENCE_QUERY_SCHEMA_VERSION).toBe(
      publicContracts.MARKET_INTELLIGENCE_QUERY_SCHEMA_VERSION
    )
    expect(serviceShim.MARKET_INTELLIGENCE_QUERY_TYPES).toEqual(publicContracts.MARKET_INTELLIGENCE_QUERY_TYPES)
    expect(serviceShim.MARKET_INTELLIGENCE_QUERY_CAVEATS).toEqual(publicContracts.MARKET_INTELLIGENCE_QUERY_CAVEATS)
  })
})
