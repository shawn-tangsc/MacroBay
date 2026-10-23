import { expect, it } from 'vitest'

import { marketIntelligenceTraceabilityPolicy, provenanceMethods } from '../../../contracts/provenanceContracts'
import { traceabilityCatalog, traceabilityFamiliesOwnedHere } from './traceabilityCatalog'
import { buildProvenanceIndex, renderProvenanceIndex } from './traceabilityIndex'

/**
 * 索引是**生成的**（设计 144 §4.3）：这几条断言的作用是让"新增一族却忘了索引"必然变红。
 */
it('covers exactly the families the catalogue declares, so a new family cannot be forgotten', () => {
  const index = buildProvenanceIndex()
  expect(index.families.map(family => family.id)).toEqual(traceabilityCatalog.map(entry => entry.id))
  expect(index.families.map(family => family.id)).toEqual([...traceabilityFamiliesOwnedHere])
  // 每一族都要有模型读得懂的名字与来源路线：只给 key 等于没给。
  for (const family of index.families) {
    expect(family.label.length).toBeGreaterThan(0)
    expect(family.nameKey).toMatch(/^provenance\./)
    expect(family.route.length).toBeGreaterThan(0)
  }
})

it('names the other side instead of letting the model invent it', () => {
  const index = buildProvenanceIndex()
  const declared = marketIntelligenceTraceabilityPolicy.families as readonly string[]
  expect([...index.notOnThisSide].sort()).toEqual(declared.filter(id => !(traceabilityFamiliesOwnedHere as readonly string[]).includes(id)).sort())
  expect(renderProvenanceIndex(index)).toContain('不在本进程')
})

it('tells the model how to ask, and keeps the arithmetic out of the prompt', () => {
  const text = renderProvenanceIndex()
  expect(text).toContain(provenanceMethods.explainFigure)
  for (const family of buildProvenanceIndex().families) expect(text).toContain(family.label)
  // 算式不写进提示词：它是回答时现读的，抄进来就会与面板分叉（144 §5.5）。
  expect(text).not.toContain('100 ×')
})
