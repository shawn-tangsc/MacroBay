import { describe, expect, it } from 'vitest'

import { narwhalCanonicalIdentityKey, narwhalMeasureMetricKeys, narwhalSourceEventIdForIdentity } from '../marketCalendarMetricIdentity'
import { decodeCalendarSourceEventId, narwhalStandardSourceEventId } from '../marketCalendarSourceEventId'
import { narwhalObservationBatches, narwhalStandardRowInputsDetailed } from './narwhalCalendarObservationBatches'

/**
 * **多 measure 一条发布 → 每个 measure 一条 draft**（用户 2026-11-21 拍板 ①，方案 v3 §2.1–§2.4）。
 *
 * 事故形状（旧实现）：一条发布覆盖非农与失业率，draft 的 `measureKeys` 写两个码、值只带主测度一份；
 * 下游按 `measureKeys` 展开就把非农的 165 记到失业率名下——**值属于哪个指标在 draft 层就丢了**。
 *
 * 断言落在**值**：每行拿到的是它自己 measure 的值，且任一指标名取到的值不得等于兄弟指标的值。
 * 行数只用来对账（4 个 measure 就是 4 条，不是「至少 2 条」）。
 */
type Draft = Record<string, unknown>

const draftsOf = (release: unknown): Draft[] => narwhalObservationBatches([release as never], {
  locale: 'zh', parserVersion: 'v1', collectionIdPrefix: 'probe'
}).flatMap((batch) => batch.parseResult.drafts as Draft[])

const releaseOf = (values: readonly Record<string, string>[], extra: Readonly<Record<string, unknown>> = {}) => ({
  releaseId: '["probe",1]', at: '2026-11-06T13:30:00.000Z', timezone: 'America/New_York',
  seriesId: 'EMP', name: 'Employment report', country: 'USA', status: 'published',
  dateBasis: 'exact', eventDate: '2026-11-06', period: '2026-10', values, ...extra
})

const byCode = (drafts: readonly Draft[]): Map<string, Draft> =>
  new Map(drafts.map((draft) => [String(draft.measureKeys), draft]))

describe('多 measure 按指标拆行', () => {
  it('非农 165 / 失业率 4.1：两条 draft，各自带自己的前值', () => {
    const drafts = draftsOf(releaseOf([
      { measure: 'nonfarm_payrolls_change', concept: 'nonfarm_payrolls_change', previous: '165', actual: '88' },
      { measure: 'unemployment_rate', concept: 'unemployment_rate', previous: '4.1', actual: '4.2' }
    ]))
    const byMeasure = byCode(drafts)
    expect(drafts).toHaveLength(2)
    // ① 每行的值 = 它自己 measure 的值
    expect(byMeasure.get('US.NONFARM.SA.CHANGE')?.providerPrevious).toEqual({ displayValue: '165' })
    expect(byMeasure.get('US.UNEMPLOYMENT.SA.RATE')?.providerPrevious).toEqual({ displayValue: '4.1' })
    // ② 反向：按失业率取到的值 ≠ 非农那一行的值（串值即红）
    expect(byMeasure.get('US.UNEMPLOYMENT.SA.RATE')?.providerPrevious)
      .not.toEqual(byMeasure.get('US.NONFARM.SA.CHANGE')?.providerPrevious)
    // 身份各算各的：两条 draft 的键不同（否则一个批次里只能活一条）
    expect(new Set(drafts.map((draft) => String(draft.marketFactKey))).size).toBe(2)
  })

  it('每条 draft 只声称一个指标（不再「一份值覆盖两个指标」）', () => {
    const drafts = draftsOf(releaseOf([
      { measure: 'nonfarm_payrolls_change', concept: 'nonfarm_payrolls_change', previous: '165' },
      { measure: 'unemployment_rate', concept: 'unemployment_rate', previous: '4.1' }
    ]))
    // 这条断言就是旧红证：拆分前 `measureKeys` 是 'A,B'，值只有 165。
    expect(drafts.map((draft) => String(draft.measureKeys)).sort())
      .toEqual(['US.NONFARM.SA.CHANGE', 'US.UNEMPLOYMENT.SA.RATE'])
  })

  it('4 个 measure（CPI 那种）→ 4 条，四个值各自归位', () => {
    const drafts = draftsOf(releaseOf([
      { measure: 'cpi_mom', concept: 'cpi', previous: '0.2', actual: '0.3' },
      { measure: 'cpi_yoy', concept: 'cpi', previous: '2.4', actual: '2.6' },
      { measure: 'core_cpi_mom', concept: 'core_cpi', previous: '0.3', actual: '0.3' },
      { measure: 'core_cpi_yoy', concept: 'core_cpi', previous: '3.0', actual: '3.1' }
    ]))
    expect(drafts).toHaveLength(4)
    const byMeasure = byCode(drafts)
    expect(byMeasure.get('US.CPI.SA.MOM')?.providerPrevious).toEqual({ displayValue: '0.2' })
    expect(byMeasure.get('US.CPI.NSA.YOY')?.providerPrevious).toEqual({ displayValue: '2.4' })
    expect(byMeasure.get('US.CORE_CPI.SA.MOM')?.providerPrevious).toEqual({ displayValue: '0.3' })
    expect(byMeasure.get('US.CORE_CPI.NSA.YOY')?.providerPrevious).toEqual({ displayValue: '3.0' })
    // 交叉验证：任意两行的值不相等（这份夹具四个值互不相同，串了就必然撞）
    const values = drafts.map((draft) => JSON.stringify(draft.providerPrevious))
    expect(new Set(values).size).toBe(4)
  })

  it('9 个 measure 上限（PPI 那条真实形状）→ 9 条，值归位', () => {
    const nine = Object.entries(narwhalMeasureMetricKeys).slice(0, 9)
    const drafts = draftsOf(releaseOf(nine.map(([measure], index) => ({
      measure, concept: measure, previous: String(index + 1)
    }))))
    expect(drafts).toHaveLength(9)
    for (const [measure, code] of nine) {
      const index = nine.findIndex(([name]) => name === measure)
      expect(byCode(drafts).get(code)?.providerPrevious).toEqual({ displayValue: String(index + 1) })
    }
  })

  it('同一 measure 出现两次（同码）：只留一条，留带 actual 的那条', () => {
    const drafts = draftsOf(releaseOf([
      { measure: 'unemployment_rate', concept: 'unemployment_rate', previous: '4.1' },
      { measure: 'unemployment_rate', concept: 'unemployment_rate', previous: '4.1', actual: '4.2' }
    ]))
    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.providerActual).toEqual({ displayValue: '4.2' })
  })

  it('主测度那条的身份与拆分前逐字节相同（旧键可解、历史行不用重认）', () => {
    // 真实数据里的形状：headline 概念是失业率，所以主测度是失业率、不是列表第一个。
    const drafts = draftsOf(releaseOf([
      { measure: 'nonfarm_payrolls_change', concept: 'unemployment_rate', previous: '165' },
      { measure: 'unemployment_rate', concept: 'unemployment_rate', previous: '4.1' }
    ]))
    const primary = drafts.find((draft) => String(draft.measureKeys) === 'US.UNEMPLOYMENT.SA.RATE')
    expect(String(primary?.sourceEventId)).toBe(narwhalSourceEventIdForIdentity({
      countryCode: 'USA', metricKey: 'US.UNEMPLOYMENT.SA.RATE', periodKey: '2026-10'
    }))
  })

  it('事件型（没有数值格）不拆：仍是一条 draft', () => {
    const drafts = draftsOf(releaseOf([], { name: 'FOMC statement', period: undefined, seriesId: 'FOMC' }))
    expect(drafts).toHaveLength(1)
  })
})
/**
 * **标准行的身份是四段**（方案 §2.4）：`国家|指标码|期|首次排期日`。
 * 与观测层那个三段串不是同一个东西——两层靠 `(id, 排期日)` 关联。
 */
describe('标准行身份（四段）', () => {
  const rowsOf = (release: unknown) => narwhalStandardRowInputsDetailed([release as never]).rows

  it('每个 measure 行各有自己的四段身份，解出来都带排期日', () => {
    const rows = rowsOf(releaseOf([
      { measure: 'nonfarm_payrolls_change', concept: 'nonfarm_payrolls_change', previous: '165' },
      { measure: 'unemployment_rate', concept: 'unemployment_rate', previous: '4.1' }
    ]))
    expect(rows).toHaveLength(2)
    const decoded = rows.map((row) => decodeCalendarSourceEventId(row.sourceEventId))
    expect(decoded.map((item) => item?.metricKey).sort())
      .toEqual(['US.NONFARM.SA.CHANGE', 'US.UNEMPLOYMENT.SA.RATE'])
    // 每个 id 都带排期日，且不同 measure 的 id 不同（台账 1:1）
    expect(decoded.every((item) => item?.firstScheduledDate === '2026-11-06')).toBe(true)
    expect(new Set(rows.map((row) => row.sourceEventId)).size).toBe(2)
    // 观测层那个三段函数在四段 id 上必得 undefined——两条解码链不许交叉
    expect(rows.every((row) => narwhalCanonicalIdentityKey(row.sourceEventId) === undefined)).toBe(true)
  })
})
