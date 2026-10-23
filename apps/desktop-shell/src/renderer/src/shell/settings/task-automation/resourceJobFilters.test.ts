import { describe, expect, it } from 'vitest'

import type { JobScheduleView } from '@platform/jobs'

import { buildResourceJobSourceOptions, buildResourceJobSourceSelectOptions, filterResourceJobs } from './resourceJobFilters'

describe('resourceJobFilters', () => {
  it('derives the source options from the projection instead of a hard-coded product list', () => {
    const options = buildResourceJobSourceOptions([
      job({ id: 'job-1', owner: 'product', productId: 'market-intelligence' }),
      job({ id: 'job-2', owner: 'platform', productId: null }),
      job({ id: 'job-3', owner: 'product', productId: 'sample-product' }),
      job({ id: 'job-4', owner: 'product', productId: 'market-intelligence' })
    ])

    expect(options).toEqual([
      { value: 'all', kind: 'all', productId: null },
      { value: 'platform', kind: 'platform', productId: null },
      { value: 'product:market-intelligence', kind: 'product', productId: 'market-intelligence' },
      { value: 'product:sample-product', kind: 'product', productId: 'sample-product' }
    ])
  })

  it('combines the name, source, and registration filters with AND', () => {
    const items = [
      job({ id: 'a', title: 'Alpha collect', owner: 'platform', productId: null, registered: true }),
      job({ id: 'b', title: 'Beta collect', owner: 'product', productId: 'market-intelligence', registered: true }),
      job({ id: 'c', title: 'Beta digest', owner: 'product', productId: 'market-intelligence', registered: false }),
      job({ id: 'd', title: 'Gamma collect', owner: 'product', productId: 'sample-product', registered: true })
    ]

    expect(filterResourceJobs(items, { nameQuery: '', source: 'all', registration: 'all' }).map((item) => item.id))
      .toEqual(['a', 'b', 'c', 'd'])
    expect(filterResourceJobs(items, { nameQuery: 'BETA', source: 'all', registration: 'all' }).map((item) => item.id))
      .toEqual(['b', 'c'])
    expect(filterResourceJobs(items, { nameQuery: '', source: 'product:market-intelligence', registration: 'all' }).map((item) => item.id))
      .toEqual(['b', 'c'])
    expect(filterResourceJobs(items, { nameQuery: '', source: 'all', registration: 'unregistered' }).map((item) => item.id))
      .toEqual(['c'])
    expect(filterResourceJobs(items, { nameQuery: 'beta', source: 'product:market-intelligence', registration: 'registered' }).map((item) => item.id))
      .toEqual(['b'])
    expect(filterResourceJobs(items, { nameQuery: 'beta', source: 'product:sample-product', registration: 'all' }))
      .toEqual([])
  })

  it('treats whitespace-only searches as no filter', () => {
    const items = [job({ id: 'a', title: 'Alpha' })]
    expect(filterResourceJobs(items, { nameQuery: '   ', source: 'all', registration: 'all' })).toEqual(items)
  })

  it('keeps the full product name as both the option label and its hover title', () => {
    const options = buildResourceJobSourceOptions([
      job({ id: 'job-1', owner: 'product', productId: 'market-intelligence' }),
      job({ id: 'job-2', owner: 'product', productId: 'sample-product' })
    ])

    expect(buildResourceJobSourceSelectOptions(
      options,
      { allSources: '全部来源', platform: '平台', product: '产品' },
      { 'market-intelligence': 'Market Intelligence', 'sample-product': 'Sample Product' }
    )).toEqual([
      { value: 'all', label: '全部来源', title: '全部来源' },
      { value: 'platform', label: '平台', title: '平台' },
      { value: 'product:market-intelligence', label: 'Market Intelligence', title: 'Market Intelligence' },
      { value: 'product:sample-product', label: 'Sample Product', title: 'Sample Product' }
    ])
  })

  it('falls back to the product id instead of truncating a product without a display name', () => {
    const options = buildResourceJobSourceOptions([
      job({ id: 'job-1', owner: 'product', productId: 'unregistered-product-module' })
    ])

    expect(buildResourceJobSourceSelectOptions(
      options,
      { allSources: 'All sources', platform: 'Platform', product: 'Product' },
      {}
    )[2]).toEqual({
      value: 'product:unregistered-product-module',
      label: 'unregistered-product-module',
      title: 'unregistered-product-module'
    })
  })
})

function job(overrides: Partial<JobScheduleView>): JobScheduleView {
  return {
    id: 'job-1',
    title: 'Job',
    owner: 'platform',
    productId: null,
    trigger: { kind: 'manual' },
    registered: true,
    nextRunAt: null,
    lastRunAt: null,
    lastOutcome: 'never',
    lastRunStatus: null,
    lastDurationMs: null,
    lastErrorSummary: null,
    ...overrides
  }
}
