// @vitest-environment happy-dom
import { expect, it } from 'vitest'

import { marketIntelligenceTraceabilityPolicy } from '../../../../contracts/provenanceContracts'
import { macroRatesSnapshotPublicPolicy } from '../../../../contracts/macro/macroRatesSnapshotContracts'
import { FRED_MACRO_ADAPTER_CONFIG } from '../../../../service/intelligence/application/macroSourceCatalogMetadata'
import * as serviceSide from '../../../../service/intelligence/provenance/traceabilityCatalog'
import * as rendererSide from './crossAssetTraceability'

/**
 * 两张口径目录合起来是否真的覆盖了"读者能看到的数"（设计 144 §4.1 的实现期修正 I1）。
 *
 * 这一条只能在这里断言：渲染侧的测试可以 import 服务侧（既有做法，面板测试也这样取真实查询），
 * 反过来不行——服务侧 import 渲染代码就是跨进程。
 */
const both = [serviceSide, rendererSide]

it('splits the reader-visible families between the two catalogs without overlap', () => {
  const serviceFamilies = [...serviceSide.traceabilityFamiliesOwnedHere]
  const rendererFamilies = [...rendererSide.traceabilityFamiliesOwnedHere]
  const declared = [...marketIntelligenceTraceabilityPolicy.families]
  // 互不重叠：同一族两边都写，就会出现两种口径。
  expect(serviceFamilies.filter(id => rendererFamilies.includes(id))).toEqual([])
  // 合起来正好等于契约清单：新增一族只登记一处会在这里红。
  expect([...serviceFamilies, ...rendererFamilies].sort()).toEqual([...declared].sort())
  for (const catalog of both) {
    expect(catalog.traceabilityCatalog.map(entry => entry.id)).toEqual([...catalog.traceabilityFamiliesOwnedHere])
  }
})

it('resolves every reference in both catalogs, and only names functions that exist', () => {
  for (const catalog of both) {
    for (const entry of catalog.traceabilityCatalog) {
      const resolved = catalog.resolveTraceabilityPolicyRefs(entry)
      expect(Object.keys(resolved)).toEqual([...entry.formula.policyRefs])
      for (const [ref, value] of Object.entries(resolved)) {
        const usable = typeof value === 'number' ? Number.isFinite(value) : typeof value === 'string' ? value.length > 0 : value.length > 0
        expect(usable, `${entry.id} → ${ref}`).toBe(true)
      }
      for (const name of entry.formula.functionRefs) {
        expect(Object.hasOwn(catalog.traceabilityFunctionRefs, name), `${entry.id} → ${name}`).toBe(true)
      }
    }
  }
})

it('states the daily row\'s numbers from the contract and the source catalog that own them', () => {
  const entry = rendererSide.resolveTraceability('daily-rate-row')!
  const refs = rendererSide.resolveTraceabilityPolicyRefs(entry)
  expect(refs['daily.series-ids']).toEqual(macroRatesSnapshotPublicPolicy.seriesIds)
  expect(refs['daily.release-cadence']).toBe('daily')
  expect(refs['daily.maximum-readings']).toBe(4)
  // 节律的 owner 是服务侧来源目录，契约只是镜像：这条断言就是"镜像不会漂移"的证明。
  expect(FRED_MACRO_ADAPTER_CONFIG.releaseCadence).toBe(macroRatesSnapshotPublicPolicy.releaseCadence)
  // 别侧的族老实说不在这一侧。
  expect(rendererSide.isTraceabilityFamilyOwnedHere('cross-market-reading')).toBe(false)
  expect(rendererSide.resolveTraceability('chart-sampling')).toBeUndefined()
})
