import { describe, expect, it } from 'vitest'

import { normalizeEntityName, parseNewsSentimentEntities } from './newsSentimentEntities'

describe('parseNewsSentimentEntities', () => {
  it('treats a missing field as "no entities" rather than a contract violation', () => {
    expect(parseNewsSentimentEntities(undefined)).toEqual({ ok: true, value: [] })
    expect(parseNewsSentimentEntities(null)).toEqual({ ok: true, value: [] })
  })

  it('rejects a set whose kind is outside the closed set, so a broken answer cannot be used as a merge key', () => {
    expect(parseNewsSentimentEntities([{ name: 'sec', kind: 'regulator' }]).ok).toBe(false)
    expect(parseNewsSentimentEntities('sec').ok).toBe(false)
    expect(parseNewsSentimentEntities([{ name: 7, kind: 'org' }]).ok).toBe(false)
  })

  it('normalises the same name written two ways into one entity', () => {
    const parsed = parseNewsSentimentEntities([
      { name: 'U.S. SEC', kind: 'org' },
      { name: 'u.s. sec', kind: 'org' },
      { name: '  U.S.  SEC  ', kind: 'org' }
    ])
    expect(parsed).toEqual({ ok: true, value: [{ name: 'u.s. sec', kind: 'org' }] })
  })

  it('drops an empty name instead of failing the whole judgement', () => {
    const parsed = parseNewsSentimentEntities([
      { name: '()', kind: 'org' },
      { name: 'binance', kind: 'org' }
    ])
    expect(parsed).toEqual({ ok: true, value: [{ name: 'binance', kind: 'org' }] })
  })

  it('sorts deterministically and caps the list', () => {
    const many = Array.from({ length: 20 }, (_, index) => ({ name: `entity-${index}`, kind: 'org' }))
    const parsed = parseNewsSentimentEntities(many)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value).toHaveLength(12)
    expect(parsed.value.map((entity) => entity.name)).toEqual(
      [...parsed.value.map((entity) => entity.name)].sort()
    )
  })
})

describe('normalizeEntityName', () => {
  it('lowercases, folds whitespace, strips wrapping punctuation and truncates', () => {
    expect(normalizeEntityName('  "U.S.  SEC"  ')).toBe('u.s. sec')
    expect(normalizeEntityName('“Binance”')).toBe('binance')
    expect(normalizeEntityName('x'.repeat(200))).toHaveLength(60)
  })
})
