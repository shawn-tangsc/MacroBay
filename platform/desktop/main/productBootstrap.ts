import type { AppLog } from '../../observability/logging/appLog'
import { productIdOf } from '../../product-registry/productRegistrationFailure'
import type { BootFailureDetail } from './failurePresentation'

/**
 * 启动时产品注册这一段：注册服务 → 封口 IPC 面 → 可选的验收报告。
 *
 * 这里曾经是一个裸 `catch {}`：任何一步抛错都只把 IPC 面标记为不可用然后返回，日志里一个字都没有。
 * 结果是窗口停在空白页，用户只能从白屏反推。所以这条路径上的失败必须先留下**具名记录**再降级。
 */

/** 稳定错误码：日志里按它 grep，界面失败页也按它展示。 */
export const PRODUCT_BOOTSTRAP_FAILED_CODE = 'product-bootstrap-failed'

/** 日志事件名，沿用主进程 `app.*` 命名。 */
export const PRODUCT_BOOTSTRAP_FAILED_EVENT = 'app.product-bootstrap-failed'

/** 失败发生在哪一步。三个值就是三步，别合并成一个 `bootstrap`：定位时它比堆栈更快。 */
export type ProductBootstrapStage =
  | 'register-product-services'
  | 'seal-ipc-surface'
  | 'report-acceptance'

export interface ProductBootstrapSteps<Sealed> {
  /** 注册产品服务；未启用产品的运行模式可以不传。 */
  registerProductServices?: () => Promise<void>
  /** 注册完成后封口 IPC 面，返回封口结果供验收报告使用。 */
  sealIpcSurface: () => Sealed
  /** 可选的验收报告；失败同样按启动失败处理。 */
  reportAcceptance?: (sealed: Sealed) => void
}

export interface ProductBootstrapDeps {
  log: Pick<AppLog, 'log'>
  /** 降级：把产品 IPC 面标记为不可用。 */
  markUnavailable: () => void
}

export type ProductBootstrapResult =
  | { ok: true }
  | { ok: false; failure: BootFailureDetail }

/** 抛出来的东西不一定是 Error（字符串、对象都见过），但日志里必须有一句人能读的原因。 */
function describeReason(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/**
 * 跑完三步，返回 `ready` / `failed`；失败时先写日志再降级，顺序不能反——
 * 先降级后写日志的话，一次写日志自身的异常会把「为什么降级」一起吞掉。
 */
export async function runProductBootstrap<Sealed>(
  steps: ProductBootstrapSteps<Sealed>,
  deps: ProductBootstrapDeps
): Promise<ProductBootstrapResult> {
  let stage: ProductBootstrapStage = 'register-product-services'
  try {
    await steps.registerProductServices?.()
    stage = 'seal-ipc-surface'
    const sealed = steps.sealIpcSurface()
    stage = 'report-acceptance'
    steps.reportAcceptance?.(sealed)
    return { ok: true }
  } catch (error) {
    // 只读取一次，再同时喂给日志与返回值：两份对象各自调用一次纯函数，今天相等只是因为
    // 输入相同；而这两条记录正是白窗口时唯一能对上的证据，不允许「碰巧一致」。
    const productId = productIdOf(error)
    const message = describeReason(error)

    deps.log.log('error', PRODUCT_BOOTSTRAP_FAILED_EVENT, {
      code: PRODUCT_BOOTSTRAP_FAILED_CODE,
      stage,
      // `message`：原文，日志专用。屏幕上的 `reason` 是它脱敏锚定后的派生，两者必须不同。
      productId,
      message
    })
    deps.markUnavailable()
    return {
      ok: false,
      failure: {
        code: PRODUCT_BOOTSTRAP_FAILED_CODE,
        stage,
        productId,
        reason: message
      }
    }
  }
}
