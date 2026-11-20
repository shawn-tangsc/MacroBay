import { describe, expect, it, vi } from 'vitest'

import { readFredIndicatorYoY } from './fredIndicatorYoY'

/**
 * 红线：**只用 FRED 直接给的同比**（`units=pc1`），不许拿指数相除。
 * 这条用例同时钉住请求参数——`units` 一旦不是 `pc1`，读回来的就是指数，除出来就是自算同比。
 */
describe('readFredIndicatorYoY', () => {
  it('asks FRED for its own year-over-year (units=pc1), never for an index', async () => {
    const fetchObservations = vi.fn(async () => [{ date: '2026-09-01', value: '3.73768' }])
    await readFredIndicatorYoY('US.CPI.NSA.YOY', fetchObservations)
    expect(fetchObservations).toHaveBeenCalledWith(expect.objectContaining({
      seriesId: 'CPIAUCNS', units: 'pc1'
    }))
  })

  /**
   * 口径跟着码走（架构师 2026-11-14）：月率要 `pch`、同比要 `pc1`，同一个调用点不许按码分支。
   * 这条能红的真情况：有人把 `units` 改回一个全局值，月率那几格就会去要同比。
   */
  it('asks for pch on a month-over-month metric and pc1 on a year-over-year one', async () => {
    const fetcher = vi.fn(async () => [{ date: '2026-10-01', value: '0.35' }])
    await readFredIndicatorYoY('US.CPI.SA.MOM', fetcher)
    expect(fetcher).toHaveBeenCalledWith(expect.objectContaining({ seriesId: 'CPIAUCSL', units: 'pch' }))
    await readFredIndicatorYoY('US.AHE.NSA.YOY', fetcher)
    expect(fetcher).toHaveBeenCalledWith(expect.objectContaining({ seriesId: 'CEU0500000003', units: 'pc1' }))
    // 没有登记口径的码不许有「默认 units」：读不到就是 no-series，不发请求。
    const untouched = vi.fn(async () => [])
    const reading = await readFredIndicatorYoY('US.PCE.NSA.YOY', untouched)
    expect(reading).toEqual({ state: 'unavailable', seriesId: '', reason: 'no-series' })
    expect(untouched).not.toHaveBeenCalled()
  })

  it('returns the value FRED published, with its observation date', async () => {
    const reading = await readFredIndicatorYoY('US.CORE_CPI.NSA.YOY', async () => [{ date: '2026-09-01', value: '2.56436' }])
    expect(reading).toEqual({ state: 'ok', value: 2.56436, observedAt: '2026-09-01T00:00:00.000Z', seriesId: 'CPILFENS' })
  })

  /** FRED 用 `.` 表示缺值：跳过它去拿上一个有值的，不许当 0、也不许当「没有这一期」。 */
  it('skips FRED empty observations instead of reading them as zero', async () => {
    const reading = await readFredIndicatorYoY('US.CPI.NSA.YOY', async () => [
      { date: '2026-10-01', value: '.' },
      { date: '2026-09-01', value: '3.73768' }
    ])
    expect(reading).toMatchObject({ state: 'ok', value: 3.73768 })
  })

  /** 读失败是「读不到」，不是「没有值」：两者在卡上是两句不同的话。 */
  it('reports a failed read as unavailable rather than as an absent value', async () => {
    const reading = await readFredIndicatorYoY('US.CPI.NSA.YOY', async () => { throw new Error('network') })
    expect(reading).toEqual({ state: 'unavailable', seriesId: 'CPIAUCNS', reason: 'read-failed' })
  })

  /** 上一期也只有官方一处是真的：连它前面那个有值的观测一起带回来。 */
  it('carries the previous observation so 上一期 never has to ask the old source', async () => {
    const reading = await readFredIndicatorYoY('US.CPI.NSA.YOY', async () => [
      { date: '2026-10-01', value: '3.8' },
      { date: '2026-09-01', value: '3.73768' },
      { date: '2026-08-01', value: '3.5' }
    ])
    expect(reading).toEqual({
      state: 'ok', value: 3.8, observedAt: '2026-10-01T00:00:00.000Z', seriesId: 'CPIAUCNS',
      previous: { value: 3.73768, observedAt: '2026-09-01T00:00:00.000Z' }
    })
  })

  it('skips empty rows when picking the previous observation', async () => {
    const reading = await readFredIndicatorYoY('US.CPI.NSA.YOY', async () => [
      { date: '2026-10-01', value: '3.8' },
      { date: '2026-09-01', value: '.' },
      { date: '2026-08-01', value: '3.5' }
    ])
    expect(reading).toMatchObject({ state: 'ok', previous: { value: 3.5 } })
  })

  it('reports no observation when every row is empty', async () => {
    const reading = await readFredIndicatorYoY('US.CPI.NSA.YOY', async () => [{ date: '2026-09-01', value: '.' }])
    expect(reading).toEqual({ state: 'unavailable', seriesId: 'CPIAUCNS', reason: 'no-observation' })
  })
})
