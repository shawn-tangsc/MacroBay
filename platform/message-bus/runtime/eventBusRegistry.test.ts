import { describe, expect, it } from 'vitest'

import { createEventBusRegistry } from './eventBusRegistry'

describe('event bus registry', () => {
  it('registers consumers by topic and rejects duplicate ids', () => {
    const registry = createEventBusRegistry()
    registry.register(
      {
        consumerId: 'product-a.consumer',
        owner: 'product',
        productId: 'product-a',
        topics: ['product-a.event.created']
      },
      async () => undefined
    )

    expect(registry.findByTopic('product-a.event.created')).toHaveLength(1)
    expect(() =>
      registry.register(
        {
          consumerId: 'product-a.consumer',
          owner: 'product',
          productId: 'product-a',
          topics: ['product-a.event.created']
        },
        async () => undefined
      )
    ).toThrow('already registered')
  })
})
