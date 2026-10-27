/**
 * 覆盖层：产品 IPC 注册处唯一的一道闸。
 *
 * 默认拒绝——有示例数据的读接口放行，写接口一律拒绝，其余读接口报缺。
 * 真实 handler 在示例模式下**永不执行**，所以示例数据不可能进入任何 store、pipeline 或分析表。
 */

import type { ProductIpcHandler, ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import type { SampleModeRecorder } from './demoRecorder'
import {
  SAMPLE_MODE_ERRORS,
  isSampleModeControlMethod,
  isSampleModeReadMethod,
  isSampleModeWriteMethod
} from './demoScenario'
import type { SampleModeSession } from './demoSession'

export type SampleModeHandlerInput = Readonly<{
  method: string
  handler: ProductIpcHandler
  session: SampleModeSession
  recorder?: SampleModeRecorder
}>

export function withSampleMode(input: SampleModeHandlerInput): ProductIpcHandler {
  return async (payload: unknown) => {
    // 控制面（进入/退出/读状态）永远落到真实 handler：否则示例模式自己都关不掉。
    if (isSampleModeControlMethod(input.method)) return input.handler(payload)
    if (!input.session.view().active) {
      const result = await input.handler(payload)
      // 只录读：写接口的返回可能带凭据（revealCredential 之类），录制文件是会落盘的。
      if (isSampleModeReadMethod(input.method)) input.recorder?.record(input.method, payload, result)
      return result
    }
    if (isSampleModeWriteMethod(input.method)) throw new Error(`${SAMPLE_MODE_ERRORS.readOnly}:${input.method}`)
    const served = input.session.lookup(input.method, payload)
    if (served === undefined) throw new Error(`${SAMPLE_MODE_ERRORS.surfaceMissing}:${input.method}`)
    return served
  }
}

/** 把整个产品注册表包一层：方法集合不变（seal 的基线校验因此不受影响），只换执行。 */
export function wrapProductRegistrar(
  register: ProductIpcRegistrar,
  session: SampleModeSession,
  recorder?: SampleModeRecorder
): ProductIpcRegistrar {
  return (productId, method, handler) =>
    register(productId, method, withSampleMode({ method, handler, session, ...(recorder ? { recorder } : {}) }))
}

/** IPC 边界只回结构化错误码：界面据此显示「示例模式下不可用」，不打印堆栈。 */
export function isSampleModeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.startsWith(SAMPLE_MODE_ERRORS.readOnly) || message.startsWith(SAMPLE_MODE_ERRORS.surfaceMissing)
}
