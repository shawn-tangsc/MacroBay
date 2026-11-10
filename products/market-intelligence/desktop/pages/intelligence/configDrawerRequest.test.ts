import { describe, expect, it } from 'vitest'

import { businessFocusFromRequest, menuFromSettingsDrawer, normalizeConfigDrawerRequest, sourcesDataRequestFor } from './configDrawerRequest'

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

describe('the shell jump maps to a menu only when it is ours and known', () => {
  it('opens the run log for our own runLog jump', () => {
    expect(menuFromSettingsDrawer({ productId: 'market-intelligence', menuId: 'runLog' })).toBe('runLog')
  })

  it('ignores another product', () => {
    expect(menuFromSettingsDrawer({ productId: 'something-else', menuId: 'runLog' })).toBeUndefined()
  })

  it('ignores a menu it does not know, instead of guessing a default', () => {
    expect(menuFromSettingsDrawer({ productId: 'market-intelligence', menuId: 'nope' })).toBeUndefined()
    expect(menuFromSettingsDrawer(undefined)).toBeUndefined()
  })
})

describe('businessFocusFromRequest', () => {
  it('hands the business / module / cell over to the screen that can use them', () => {
    expect(businessFocusFromRequest({
      menu: 'sourcesData',
      focus: { menu: 'sourcesData', business: 'calendar', moduleKey: 'macro', cellId: 'macro:cpi' }
    })).toEqual({ business: 'calendar', moduleKey: 'macro', cellId: 'macro:cpi' })
  })

  it('returns nothing when the request is for another screen', () => {
    // 停在别的屏却带着这一屏的坐标，读者会以为「定位失效」；真相是这条请求没打算落在那屏。
    expect(businessFocusFromRequest({
      menu: 'sources',
      focus: { menu: 'sourcesData', business: 'calendar' } as never
    })).toBeUndefined()
  })

  it('treats an empty position as no position at all', () => {
    // 空对象传下去，组件会以为「有定位但什么都没说」——那是两种不同的意图。
    expect(businessFocusFromRequest({ menu: 'sourcesData', focus: { menu: 'sourcesData' } })).toBeUndefined()
    expect(businessFocusFromRequest({ menu: 'sourcesData' })).toBeUndefined()
  })
})

describe('sourcesDataRequestFor', () => {
  it('carries the position through, and keeps the focus menu matching', () => {
    // 归一化会丢弃「focus.menu 与菜单不一致」的定位——所以 `focus.menu` 由这个函数补，不由入口记。
    const request = sourcesDataRequestFor({ business: 'calendar', moduleKey: 'macro', cellId: 'macro:cpi' })
    expect(request.focus?.menu).toBe('sourcesData')
    expect(normalizeConfigDrawerRequest(request)).toEqual(request)
  })

  it('asks for the screen alone when there is no position', () => {
    expect(sourcesDataRequestFor()).toEqual({ menu: 'sourcesData' })
    expect(sourcesDataRequestFor()).not.toHaveProperty('focus')
  })
})
