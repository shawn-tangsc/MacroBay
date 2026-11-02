import { describe, expect, it } from 'vitest'

import { createNotificationProducerOwnership } from './notificationProducerOwnership'

describe('notification producer ownership', () => {
  it('maps claims to their product', () => {
    const ownership = createNotificationProducerOwnership({
      manifests: [
        { id: 'market-intelligence', notificationProducerClaims: ['market-intelligence.dailyBriefing'] }
      ]
    })
    expect(ownership['market-intelligence.dailyBriefing']).toEqual({ productId: 'market-intelligence' })
    expect(ownership['unclaimed']).toBeUndefined()
  })

  it('refuses a claim with another product prefix', () => {
    expect(() =>
      createNotificationProducerOwnership({
        manifests: [{ id: 'market-intelligence', notificationProducerClaims: ['other-product.job'] }]
      })
    ).toThrow(/notification-producer-claim-prefix-mismatch/)
  })

  it('refuses the same producer claimed twice', () => {
    expect(() =>
      createNotificationProducerOwnership({
        manifests: [
          { id: 'market-intelligence', notificationProducerClaims: ['market-intelligence.dailyBriefing'] },
          { id: 'market-intelligence', notificationProducerClaims: ['market-intelligence.dailyBriefing'] }
        ]
      })
    ).toThrow(/notification-producer-claim-conflict/)
  })

  it('refuses an empty claim instead of silently registering it', () => {
    expect(() =>
      createNotificationProducerOwnership({
        manifests: [{ id: 'market-intelligence', notificationProducerClaims: ['  '] }]
      })
    ).toThrow(/notification-producer-claim-empty/)
  })
})
