import { describe, expect, it } from 'vitest'

import * as publicContracts from './intelligenceEvents'
import * as serviceContracts from '../service/intelligence/schema/intelligenceEvents'

describe('market intelligence public event contracts', () => {
  it('keeps service schema re-exports aligned with the public contract module', () => {
    expect(serviceContracts.INTELLIGENCE_EVENT_SCHEMA_VERSION).toBe(publicContracts.INTELLIGENCE_EVENT_SCHEMA_VERSION)
    expect(serviceContracts.INTELLIGENCE_EVENT_TOPICS).toEqual(publicContracts.INTELLIGENCE_EVENT_TOPICS)
  })
})
