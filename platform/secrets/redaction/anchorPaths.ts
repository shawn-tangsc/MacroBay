/**
 * 路径脱敏的**唯一实现**（启动失败页与产品页失败折叠区共用）。
 *
 * 从 `platform/desktop/main/failurePresentation.ts` 原样搬出，只改一处行为（用户 2026-11-03 定）：
 * **home 路径从「只留末段」改成 `~/<末段>`**，其余（仓库内路径保留相对形态、其它绝对路径只留末段）
 * 一字不变。启动失败页因此有一条用户可见变化，测试同批改了期望值。
 *
 * 为什么住在 `platform/secrets/redaction/`：这是身份信息脱敏，与 `redactText` 的凭据模式表同属
 * 一条安全边界；渲染层只许**深路径** import 这个纯文件，不许 import `@platform/secrets` 桶
 * （桶会拉 electron/vault）。
 */

/** 省略号用 U+2026：等宽字体里 `...` 占三格，白吃诊断信息的位置。 */
export const FAILURE_ELLIPSIS = '…'

/** 从仓库根锚起，保留可诊断性；对不上任何根的路径只留文件名。 */
const REPO_ANCHORS = ['products/', 'platform/', 'apps/', 'scripts/'] as const

function normalizePath(rawPath: string): string {
  let normalized = rawPath.replace(/\\/gu, '/')
  // file:///Users/… 与 \\?\C:\Users\… 是 Electron 报错里最常见的两种前缀。
  normalized = normalized.replace(/^file:\/\/+/u, '/')
  normalized = normalized.replace(/^\/\/\?\//u, '/')
  return normalized
}

function basenameOf(normalizedPath: string): string {
  return normalizedPath.slice(normalizedPath.lastIndexOf('/') + 1)
}

/** home 形态：`/Users/…`、`/home/…`、`C:/Users/…`、`/C:/Users/…`（长路径归一后）。 */
function isHomePath(normalizedPath: string): boolean {
  return /^\/?(?:[A-Za-z]:)?\/(?:Users|home)\/[^/]+(?:\/|$)/iu.test(normalizedPath)
}

/** 单条路径：home → `~/<末段>`；仓库内 → `…/platform/...`；其它绝对路径 → `…/<末段>`。 */
export function anchorOne(rawPath: string): string {
  const normalized = normalizePath(rawPath)
  if (isHomePath(normalized)) return `~/${basenameOf(normalized)}`
  for (const anchor of REPO_ANCHORS) {
    const index = normalized.indexOf(`/${anchor}`)
    if (index !== -1) return `${FAILURE_ELLIPSIS}/${normalized.slice(index + 1)}`
    if (normalized.startsWith(anchor)) return `${FAILURE_ELLIPSIS}/${normalized}`
  }
  return `${FAILURE_ELLIPSIS}/${basenameOf(normalized)}`
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
