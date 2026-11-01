import { redactText } from '../../secrets/redaction/redactText'

/**
 * 启动失败页要显示的东西：一份结构，两个视图。
 *
 * 日志侧零变换（原文落盘，一个字不截）；屏幕侧按顺序做三件事：**先凭据脱敏，再路径锚定，最后裁两行**。
 * 顺序反了会漏——`https://user:token@host/Users/x/...` 如果先把 `/Users/x` 锚掉，剩下的 token 还在屏幕上。
 *
 * 这个模块只依赖 `redactText`（平台唯一的凭据模式表）。**不许 import 设置、i18n、主题或任何产品模块**：
 * 失败页存在的意义就是「别的东西都挂了」，它自己再挂一次就没有兜底了。
 */

/** 省略号用 U+2026：等宽字体里 `...` 占三格，白吃诊断信息的位置。 */
export const FAILURE_ELLIPSIS = '…'

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

/** 从仓库根锚起，保留可诊断性；对不上任何根的路径只留文件名。 */
const REPO_ANCHORS = ['products/', 'platform/', 'apps/', 'scripts/'] as const

function anchorOne(rawPath: string): string {
  const normalized = rawPath.replace(/\\/gu, '/')
  const withoutFileProtocol = normalized.replace(/^file:\/\/\/?/u, '/')
  for (const anchor of REPO_ANCHORS) {
    const index = withoutFileProtocol.indexOf(`/${anchor}`)
    if (index !== -1) return `${FAILURE_ELLIPSIS}/${withoutFileProtocol.slice(index + 1)}`
    if (withoutFileProtocol.startsWith(anchor)) return `${FAILURE_ELLIPSIS}/${withoutFileProtocol}`
  }
  const base = withoutFileProtocol.slice(withoutFileProtocol.lastIndexOf('/') + 1)
  return `${FAILURE_ELLIPSIS}/${base}`
}

/**
 * 五种形态覆盖两类用户：`/Users/…`、`/home/…` 是 POSIX；`C:\Users\…`、`\\?\C:\…` 是 Windows；
 * `file:///…` 是 Electron 加载失败消息的常见形态——只挡 POSIX 等于只挡住一半用户。
 */
const HOME_PATH_PATTERNS: readonly RegExp[] = [
  // file:///Users/<名>/…（不是 JSON 时斜杠是单层；JSON 里会变成 file:\\/\\/\\/…，先按 \\ 归一）
  /file:(?:\\?\/){3}[^\s'"]+/gu,
  // \\?\C:\Users\<名>\… 长路径前缀
  /\\\\\?\\[A-Za-z]:\\[^\s'"]+/gu,
  // C:\Users\<名>\…（JSON 里分隔符可能被写成 \\）
  /[A-Za-z]:\\{1,2}Users\\{1,2}[^\s'"]+/gu,
  // /Users/<名>/… 与 /home/<名>/…
  /\/(?:Users|home)\/[^\s'"/]+(?:\/[^\s'"]*)?/gu
]

/** 路径锚定：纯文本变换，逐字符只依赖输入本身。 */
export function anchorPaths(text: string): string {
  return HOME_PATH_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, (match) => anchorOne(match)),
    text
  )
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
 * 一份结构、两个视图：日志侧写 `detail.reason` 原文（一个字不改），屏幕侧用这里返回的
 * `reason`（裁断）与 `reasonFull`（技术详情）。屏幕侧的字段不承载原文——多存一份没人读的原文，
 * 就是这个仓库重复清除过的「预留字段」。
 */
export function presentBootFailure(detail: BootFailureDetail): ScreenFailure {
  // 顺序即泄漏防线的顺序：先凭据（redactText，平台唯一模式表），再路径（anchorPaths），最后裁断。
  const credentialSafe = redactText(detail.reason).text
  const anchored = anchorPaths(credentialSafe)
  return {
    code: detail.code,
    stage: detail.stage,
    productId: detail.productId,
    reason: truncateForScreen(anchored),
    reasonFull: anchored
  }
}
