import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import { isProvenanceExplainQuery, parseProvenanceExplanation, provenanceMethods, type ProvenanceExplanation } from '../../../contracts/provenanceContracts'
import { explainFigure } from './traceabilityExplain'

const productId = 'market-intelligence'

/**
 * 口径查询的门（设计 144 §4.2）：只读，回答"这个数从哪来、怎么算的"。
 *
 * 与其它只读门一样：请求先过守卫（只接受一个族名），答案再过一次产品边界的解析器——服务侧说的形状与
 * 渲染侧读到的形状必须是同一份，任何不合法的输出都塌成 `unavailable`，而不是把可疑形状送出去。
 *
 * 内核是纯函数（`explainFigure`），所以这里没有任何依赖要注入；IPC 之外的部分（agent 工具与提示词索引）
 * 见设计 144 §4.3。
 */
export function registerProvenanceIpc(register: ProductIpcRegistrar): void {
  register(productId, provenanceMethods.explainFigure, async payload => {
    try {
      if (!isProvenanceExplainQuery(payload)) return unavailable()
      return parseProvenanceExplanation(explainFigure(payload.family)) ?? unavailable()
    } catch {
      return unavailable()
    }
  })
}

function unavailable(): ProvenanceExplanation {
  return Object.freeze({ state: 'unavailable' as const, family: '', reason: 'unknown-family' as const, ownedHere: Object.freeze([]) })
}
