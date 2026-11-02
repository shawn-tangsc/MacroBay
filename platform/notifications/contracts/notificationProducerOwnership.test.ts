import { describe, expect, it } from 'vitest'

import { createNotificationProducerOwnership } from './notificationProducerOwnership'

describe('notification producer ownership', () => {
  it('maps claims to their product and platform handlers to platform', () => {
    const ownership = createNotificationProducerOwnership({
      manifests: [
        { id: 'market-intelligence', notificationProducerClaims: ['market-intelligence.dailyBriefing'] }
      ],
      platformProducerIds: ['platform.agent-task']
    })
    expect(ownership['market-intelligence.dailyBriefing']).toEqual({ productId: 'market-intelligence' })
    expect(ownership['platform.agent-task']).toBe('platform')
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
