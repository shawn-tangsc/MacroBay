import { describe, expect, it } from 'vitest'

import { resolveResourceJobSourceName } from './resourceJobSourceLabel'

describe('resource job source name', () => {
  const productNames = { 'sample-product': 'Sample Product' }

  it('uses the projected product name when the product is present', () => {
    expect(resolveResourceJobSourceName(productNames, 'sample-product', '产品')).toBe('Sample Product')
  })

  it('falls back to a human word, never to the internal product id (contract v2.41, third tier)', () => {
    // 产品摘要读失败、产品被停用或卸载时，这一列不许把 `sample-product` 印给读者。
    const label = resolveResourceJobSourceName(productNames, 'retired-product', '产品')
    expect(label).toBe('产品')
    expect(label).not.toContain('retired-product')
  })

  it('treats an empty projected name as missing instead of rendering a blank cell', () => {
    expect(resolveResourceJobSourceName({ 'sample-product': '   ' }, 'sample-product', '产品')).toBe('产品')
  })

  it('uses the fallback when the job has no product at all', () => {
    expect(resolveResourceJobSourceName(productNames, null, '产品')).toBe('产品')
  })
})
