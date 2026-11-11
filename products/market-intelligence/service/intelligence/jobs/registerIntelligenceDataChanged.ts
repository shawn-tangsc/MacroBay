import { emitProductIpcEvent } from '@platform/desktop/ipc/productIpcEventBridge'
import { registerProductRunTerminalListener } from '@platform/desktop/main/runTerminalFanOut'

import { INTELLIGENCE_DATA_CHANGED_EVENT } from '../../../contracts/intelligenceDataChangedEvent'
import { createIntelligenceDataChangedEmitter } from './intelligenceDataChangedEmitter'

/**
 * 把「采集写了库 → `intelligence.dataChanged`」接到平台运行终态扇出上。
 *
 * 从 `intelligenceModule.ts` 抽出来只为体积门禁（那处是受保护接缝旁的装配，一行调用就够）；
 * 作业→源/面板的映射仍在 `jobs/dataChangedJobMap.ts`（作业注册这一侧），这里只做接线。
 */
export function registerIntelligenceDataChangedEvents(productId: string): void {
  registerProductRunTerminalListener(createIntelligenceDataChangedEmitter({
    emit: (payload) => { emitProductIpcEvent(productId, INTELLIGENCE_DATA_CHANGED_EVENT, payload) }
  }))
}
