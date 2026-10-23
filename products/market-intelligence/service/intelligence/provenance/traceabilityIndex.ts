import { marketIntelligenceTraceabilityPolicy } from '../../../contracts/provenanceContracts'
import { provenanceMethods } from '../../../contracts/provenanceContracts'
import { traceabilityCatalog, traceabilityFamiliesOwnedHere } from './traceabilityCatalog'

/**
 * 给 agent 的口径**索引**（设计 144 §4.3）。
 *
 * 存在的理由：模型不知道自己能问什么。索引告诉它"这几族有账可查、怎么查"，而**细节留在目录里**——
 * 索引本身必须短，短到每轮都塞进提示词也不心疼。
 *
 * 两条硬约束：
 *
 * 1. **它是生成的，不是手抄的**。族清单直接来自目录，所以新增一族时索引自动跟上；覆盖断言（测试）把这条
 *    钉住：索引里的族必须与目录**完全相等**，少一个就红——手抄的索引迟早与目录分叉，而分叉的后果是
 *    模型"以为没有这一族"，于是编一个。
 * 2. **别侧的族也要写进来**。契约声明了但不归这一侧的（日频行的 bp 取整在渲染侧），索引要明说"不在这一侧"，
 *    否则模型会替它编一条来源——这正是设计 144 §5.7 那条规则。
 */
export type ProvenanceIndex = Readonly<{
  version: string
  method: string
  families: readonly Readonly<{ id: string; label: string; nameKey: string; route: string; providerIds: readonly string[] }>[]
  notOnThisSide: readonly string[]
}>

export function buildProvenanceIndex(): ProvenanceIndex {
  const declared = marketIntelligenceTraceabilityPolicy.families as readonly string[]
  return Object.freeze({
    version: 'marketIntelligenceProvenanceIndex.v1',
    method: provenanceMethods.explainFigure,
    families: Object.freeze(traceabilityCatalog.map(entry => Object.freeze({
      id: entry.id, label: entry.label, nameKey: entry.nameKey,
      route: entry.source.route, providerIds: entry.source.providerIds
    }))),
    notOnThisSide: Object.freeze(declared.filter(id => !(traceabilityFamiliesOwnedHere as readonly string[]).includes(id)))
  })
}

/**
 * 索引的提示词文本：一行一族，末尾一句说明怎么深问。
 *
 * 只写"有账可查"和"怎么查"，**不写算式**——算式在回答时才现读（那是 144 §5.5 的要求：回答里的数字必须
 * 与面板同源，不能是提示词里抄下来的快照）。
 */
export function renderProvenanceIndex(index: ProvenanceIndex = buildProvenanceIndex()): string {
  const lines = index.families.map(family => `- ${family.label}（id: ${family.id}；来源: ${family.route}）`)
  if (index.notOnThisSide.length > 0) {
    lines.push(`- 以下族不在本进程：${index.notOnThisSide.join('、')}——问到它们时明说"不在这一侧"，不要替它编来源。`)
  }
  lines.push(`要引用某个数的来源、观测时刻与算式时，调用 ${index.method}（family 取上面的 id），数字以这次回答现读的为准。`)
  return lines.join('\n')
}
