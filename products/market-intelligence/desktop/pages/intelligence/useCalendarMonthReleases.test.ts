import { expect, it } from 'vitest'

import { marketEventOf } from './useCalendarMonthReleases'

/**
 * 抽屉小月历的事件对象**不再自己推 coverage**：宿主（标准表那一路）读回来是什么，这里就是什么。
 * 以前这里写死 `observed-unverified`，官方行于是被标成「未核验」——同一份数据两套标签。
 */
const row = (coverage: unknown) => ({
  eventKey: 'US.CPI.RELEASE.2026-M10', title: 'CPI', scheduledAt: '2026-11-10T13:30:00.000Z',
  eventType: 'economic-indicator', importance: 'high', source: 'Narwhal',
  sourceObservedAt: '2026-11-10T13:20:00.000Z', consensus: null, providerPrevious: null, providerActual: null,
  ...(coverage === undefined ? {} : { coverage })
})

it('passes the coverage it was given straight through, both ways', () => {
  expect(marketEventOf(row('available'))[0]?.coverage).toBe('available')
  expect(marketEventOf(row('observed-unverified'))[0]?.coverage).toBe('observed-unverified')
})

/** 缺省不是「未核验」：没有这一档就整行不收，别把官方行标错。 */
it('drops a row whose coverage is missing or unknown instead of assuming 未核验', () => {
  expect(marketEventOf(row(undefined))).toEqual([])
  expect(marketEventOf(row('verified'))).toEqual([])
})
