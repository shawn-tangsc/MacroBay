import { describe, expect, it } from 'vitest'

import {
  buildSafeCredentialView,
  createInMemoryIntelligenceCredentialStorage,
  createIntelligenceCredentialStore,
  defaultIntelligenceCredentialRef
} from './intelligenceCredentialStore'

describe('intelligenceCredentialStore', () => {
  it('stores credentials by ref and returns masked safe views only', async () => {
    const store = createIntelligenceCredentialStore(createInMemoryIntelligenceCredentialStorage())
    const credentialRef = defaultIntelligenceCredentialRef('fred')

    await store.save({ credentialRef, sourceId: 'fred', apiKey: 'super-secret-key-value' })
    const safe = await store.getSafeView(credentialRef)

    expect(safe.hasCredential).toBe(true)
    expect(safe.maskedPreview).toContain('****')
    expect(JSON.stringify(safe)).not.toContain('super-secret-key-value')
  })

  it('builds safe views for missing credentials', () => {
    const safe = buildSafeCredentialView(defaultIntelligenceCredentialRef('fred'), null)
    expect(safe.hasCredential).toBe(false)
  })
})
