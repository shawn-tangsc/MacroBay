/**
 * 示例模式的控制面：两个方法，一个读状态、一个开关。
 *
 * 它们永远落到真实 handler（见 `demoOverlay`），所以示例模式下也能退出来。
 */

import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import { SAMPLE_MODE_METHODS } from './demoScenario'
import type { SampleModeSession, SampleModeView } from './demoSession'

export type SampleModeSetActiveInput = Readonly<{ active: boolean; scenarioId?: string }>

export function readSampleModeSetActiveInput(payload: unknown): SampleModeSetActiveInput | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const record = payload as Record<string, unknown>
  if (typeof record.active !== 'boolean') return undefined
  if (record.scenarioId !== undefined && typeof record.scenarioId !== 'string') return undefined
  return {
    active: record.active,
    ...(typeof record.scenarioId === 'string' && record.scenarioId.length > 0 ? { scenarioId: record.scenarioId } : {})
  }
}

export function registerSampleModeIpc(register: ProductIpcRegistrar, productId: string, session: SampleModeSession): void {
  register(productId, SAMPLE_MODE_METHODS.getState, async (): Promise<SampleModeView> => {
    // 首次读状态时顺带数一次场景目录：UI 需要 scenarioCount 才能决定是否显示示例入口，
    // 不能等到 enter() 成功后才填这个字段（否则入口永远不出现）。
    await session.prepare()
    return session.view()
  })
  register(productId, SAMPLE_MODE_METHODS.setActive, async (payload): Promise<SampleModeView> => {
    const input = readSampleModeSetActiveInput(payload)
    if (!input) throw new Error('invalid-demo-set-active-input')
    return input.active ? session.enter(input.scenarioId) : session.exit()
  })
}
