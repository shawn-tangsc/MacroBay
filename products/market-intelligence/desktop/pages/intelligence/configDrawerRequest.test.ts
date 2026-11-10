import { describe, expect, it } from 'vitest'

import { normalizeConfigDrawerRequest } from './configDrawerRequest'

/**
 * 「永远打开、永不白屏」的判据：非法输入一律**退到该菜单的默认位置**，而不是拒绝打开或停在空白屏。
 * 只有六屏登记表里的菜单才是合法菜单；`focus` 与菜单不匹配就丢弃定位。
 */
describe('normalizeConfigDrawerRequest', () => {
  it('keeps a valid request as it is', () => {
    const request = { menu: 'sources' as const, focus: { menu: 'sources' as const, sourceId: 'bls' } }
    expect(normalizeConfigDrawerRequest(request)).toEqual(request)
  })

  it('falls back to the data-sources screen for an unknown menu', () => {
    expect(normalizeConfigDrawerRequest({ menu: 'nope' as never })).toEqual({ menu: 'sources' })
    expect(normalizeConfigDrawerRequest('nope' as never)).toEqual({ menu: 'sources' })
  })

  it('drops a focus that belongs to another menu instead of opening the wrong screen', () => {
    expect(normalizeConfigDrawerRequest({
      menu: 'briefing',
      focus: { menu: 'sources', sourceId: 'bls' } as never
    })).toEqual({ menu: 'briefing' })
  })

  it('still accepts the old bare-menu form', () => {
    expect(normalizeConfigDrawerRequest('runLog')).toEqual({ menu: 'runLog' })
    expect(normalizeConfigDrawerRequest(undefined)).toEqual({ menu: 'sources' })
  })
})
