import { expect, it } from 'vitest'

import { crossAssetContractPolicy } from '../../../contracts/crossAssetObservationContracts'
import { marketIntelligenceTraceabilityPolicy } from '../../../contracts/provenanceContracts'
import { crossAssetObservationPolicy } from '../cross-asset/crossAssetAnalytics'
import { crossAssetReadingPolicy } from '../cross-asset/crossAssetReading'
import {
  isTraceabilityFamilyOwnedHere,
  resolveTraceability,
  resolveTraceabilityPolicyRefs,
  traceabilityCatalog,
  traceabilityFamiliesOwnedHere,
  traceabilityFunctionRefs,
  traceabilityPolicyRefs
} from './traceabilityCatalog'

/**
 * 口径目录（设计 144）：agent 被问"这个数从哪来、怎么算的"时要能原原本本回答。
 *
 * 这里钉的不是文案，而是**不会说谎**这件事：算式里的每个数字都能在 owner 那里读到（不是目录里抄的），
 * 函数名真实存在，族清单与契约一致，目录之外的族老实说"没有"。
 */
const refsOf = (id: string) => resolveTraceabilityPolicyRefs(resolveTraceability(id)!)

it('resolves every policy reference the catalog names, from the owner that owns it', () => {
  for (const entry of traceabilityCatalog) {
    for (const ref of entry.formula.policyRefs) {
      // 有一个引用 id 没登记取值方式，就等于口径里有个编出来的数：宁可这里红。
      expect(Object.hasOwn(traceabilityPolicyRefs, ref), `${entry.id} → ${ref}`).toBe(true)
    }
    const resolved = resolveTraceabilityPolicyRefs(entry)
    expect(Object.keys(resolved)).toEqual([...entry.formula.policyRefs])
    for (const [ref, value] of Object.entries(resolved)) {
      const usable = typeof value === 'number' ? Number.isFinite(value) : value.length > 0
      expect(usable, `${entry.id} → ${ref}`).toBe(true)
    }
  }
})

it('names only functions that exist, so renaming one without the catalog fails here', () => {
  for (const entry of traceabilityCatalog) {
    for (const name of entry.formula.functionRefs) {
      expect(Object.hasOwn(traceabilityFunctionRefs, name), `${entry.id} → ${name}`).toBe(true)
    }
  }
})

it('reads the reading family\'s numbers from the owner, not from a copy', () => {
  const refs = refsOf('cross-market-reading')
  expect(refs['flat-band.dxy']).toBe(crossAssetObservationPolicy.flatPercent.dxy)
  expect(refs['flat-band.gold']).toBe(crossAssetObservationPolicy.flatPercent.gold)
  expect(refs['flat-band.index']).toBe(crossAssetObservationPolicy.flatPercent.index)
  expect(refs['flat-band.btc']).toBe(crossAssetObservationPolicy.flatPercent.btc)
  // 窗口缩放就是 √24：判读只用 24H，所以这一个数就是它。
  expect(Number(refs['band.window-scale-24h'])).toBeCloseTo(Math.sqrt(24), 10)
  // ρ 的周期与样本下限也来自 owner：被问"这个相关系数是几小时的"必须答得出。
  expect(refs['reading.window']).toBe(crossAssetReadingPolicy.window)
  expect(refs['reading.window']).toBe('24h')
  expect(refs['correlation.interval']).toBe('5m')
  expect(refs['correlation.minimumPairs']).toBe(crossAssetContractPolicy.minimumPairs)
  expect(refs['correlation.expectedPairs']).toBe(crossAssetContractPolicy.expectedPairs)
})

it('states the retention tiers and the chart stride from the policies that decide them', () => {
  const refs = refsOf('chart-sampling')
  expect(refs['retention.hot-ms']).toBe(8 * 24 * 3_600_000)
  expect(refs['retention.cold-ms']).toBe(30 * 24 * 3_600_000)
  expect(refs['chart.stride-7d']).toBe(12)
  // 携带与冷层取点是给跨冷层窗口准备的，30d 撤回后没有窗口用得到，所以这两个引用连同那条算式一起下线了。
  expect(Object.keys(refs)).not.toContain('chart.carry-ms')
})

it('covers exactly the families this side owns, and every family the contract declares is covered somewhere', () => {
  expect(traceabilityCatalog.map(entry => entry.id)).toEqual([...traceabilityFamiliesOwnedHere])
  for (const id of traceabilityFamiliesOwnedHere) {
    expect(marketIntelligenceTraceabilityPolicy.families as readonly string[]).toContain(id)
  }
  // 日频行的算式在渲染侧（bp 取整），服务侧不能 import 它：问它就老实说不在这一侧。
  expect(isTraceabilityFamilyOwnedHere('daily-rate-row')).toBe(false)
})

it('says "no record" for a family it does not have, rather than inventing one', () => {
  expect(resolveTraceability('moon-phase')).toBeUndefined()
  expect(resolveTraceability('daily-rate-row')).toBeUndefined()
})
