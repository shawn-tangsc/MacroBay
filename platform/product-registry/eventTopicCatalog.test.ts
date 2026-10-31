import { describe, expect, it } from 'vitest'

import { createEventTopicCatalog } from './eventTopicCatalog'

describe('event topic catalog', () => {
  it('collects declared topics in manifest order', () => {
    const catalog = createEventTopicCatalog([
      { eventTopics: ['a.item.created', 'a.source.health.changed'] },
      { eventTopics: ['b.impact.created'] }
    ])

    expect(catalog.topics).toEqual(['a.item.created', 'a.source.health.changed', 'b.impact.created'])
    expect(catalog.has('b.impact.created')).toBe(true)
    expect(catalog.has('nobody.publishes.this')).toBe(false)
  })

  it('treats a product without the field as publishing nothing', () => {
    const catalog = createEventTopicCatalog([{}, { eventTopics: [] }])

    expect(catalog.topics).toEqual([])
    expect(catalog.has('a.item.created')).toBe(false)
  })

  it('de-duplicates across products and trims the lookup instead of the stored value', () => {
    const catalog = createEventTopicCatalog([
      { eventTopics: ['shared.topic.created'] },
      { eventTopics: ['shared.topic.created'] }
    ])

    expect(catalog.topics).toEqual(['shared.topic.created'])
    expect(catalog.has('  shared.topic.created  ')).toBe(true)
  })

  it('skips blank or non-string entries rather than throwing on one bad declaration', () => {
    const catalog = createEventTopicCatalog([
      { eventTopics: ['', '   ', 'a.item.created'] as readonly string[] }
    ])

    expect(catalog.topics).toEqual(['a.item.created'])
  })
})
