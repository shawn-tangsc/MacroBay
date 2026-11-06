import { FAILURE_ELLIPSIS } from '../../secrets/redaction/anchorPaths'
import { redactDiagnosticText } from '../../secrets/redaction/redactDiagnostic'

/**
 * 启动失败页要显示的东西：一份结构，两个视图。
 *
 * 日志侧零变换（原文落盘，一个字不截）；屏幕侧按顺序做：**先凭据脱敏，再 URL 的值、home 与
 * 其它绝对路径，最后裁两行**。顺序反了会漏——`https://user:token@host/Users/x/...` 如果先锚路径，
 * 剩下的 token 还在屏幕上。
 *
 * 脱敏与产品页失败的折叠区共用 `redactDiagnosticText`（**一份实现**，住
 * `platform/secrets/redaction/`）。这个模块的依赖面仍只有纯函数：**不许 import 设置、i18n、
 * 主题或任何产品模块**——失败页存在的意义就是「别的东西都挂了」，它自己再挂一次就没有兜底了。
 */

/** 兼容既有导入路径：值与实现只有共享模块那一份。 */
export { FAILURE_ELLIPSIS, anchorPaths } from '../../secrets/redaction/anchorPaths'

/** 屏上原因最多两行。宽度按「中文一字 2 单位、其余 1 单位」计，144 单位约等于 72 个汉字或 144 个英文字符。 */
export const FAILURE_REASON_BUDGET = 144

export interface BootFailureDetail {
  /** 稳定错误码，我们自己的，单独一行、永不进裁断区。 */
  code: string
  /** 失败阶段（注册 / 封口 / 验收报告）。 */
  stage: string
  /** 哪个产品失败了；注册路径之外取不到就是 null，不猜。 */
  productId: string | null
  /** 原始 `error.message`：日志写这一份，屏上只显示它的两个变换视图。 */
  reason: string
}

function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    width += /[\u1100-\u115f\u2e80-\ua4cf\ua960-\ua97f\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u.test(char) ? 2 : 1
  }
  return width
}

/** 屏上的原因：空白折叠成单个空格，超宽就硬截并补 `…`（不做「展开」，全文在日志里）。 */
export function truncateForScreen(text: string): string {
  const collapsed = text.replace(/\s+/gu, ' ').trim()
  if (displayWidth(collapsed) <= FAILURE_REASON_BUDGET) return collapsed
  let width = 0
  let kept = ''
  for (const char of collapsed) {
    const next = width + displayWidth(char)
    if (next > FAILURE_REASON_BUDGET - displayWidth(FAILURE_ELLIPSIS)) break
    width = next
    kept += char
  }
  return `${kept.trimEnd()}${FAILURE_ELLIPSIS}`
}

export interface ScreenFailure {
  code: string
  stage: string
  productId: string | null
  /** 已脱敏、已锚定、已裁断：屏幕上那句两行原因。 */
  reason: string
  /** 已脱敏、已锚定、未裁断：屏幕上「技术详情」里的完整版。 */
  reasonFull: string
}

/**
 * 一份结构、两个视图：日志侧写 `message` 原文（一个字不改），屏幕侧用这里返回的
 * `reason`（裁断）与 `reasonFull`（技术详情），两者都由同一个 `anchored` 派生。
 */
export function presentBootFailure(detail: BootFailureDetail): ScreenFailure {
  // 顺序由 redactDiagnosticText 保证：凭据 → URL 的值 → home → 其它绝对路径；不截断。
  const anchored = redactDiagnosticText(detail.reason)
  return {
    code: detail.code,
    stage: detail.stage,
    productId: detail.productId,
    reason: truncateForScreen(anchored),
    reasonFull: anchored
  }
}
