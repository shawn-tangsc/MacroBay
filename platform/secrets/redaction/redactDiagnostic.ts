import { anchorOne, anchorPaths } from './anchorPaths'
import { redactText } from './redactText'

/**
 * 诊断原文的唯一脱敏入口（产品页失败折叠区与启动失败页共用）。
 *
 * **顺序固定，顺序错会漏**：
 *
 * 1. 凭据（`redactText`，占位符 `[REDACTED]`）**最先**——路径与 URL 规则会吃掉 `=`、`:`、`/`，
 *    凭据模式之后就匹配不上了；
 * 2. URL 的 userinfo 与 query/fragment 的**值**（键保留）——现有模式表抓不到 `user:token@` 这种形态；
 * 3. home → `~/<末段>`；
 * 4. 其它绝对路径 → `…/<末段>`，**仓库内路径保留相对形态**（`…/platform/...`）；
 * 5. **不截断**：折叠区给的是完整诊断，截断只发生在启动失败页那句两行摘要上。
 *
 * 只依赖 `redactText` 与 `anchorPaths` 两个纯文件；渲染层用深路径 import，不碰 `@platform/secrets` 桶。
 */

const URL_PATTERN = /\bhttps?:\/\/[^\s'"]+/giu

/** `a=1&b=2` → `a=***&b=***`；没有键的整段（如裸 fragment）直接 `***`。 */
function redactPairs(part: string): string {
  return part
    .split('&')
    .map((pair) => {
      const separator = pair.indexOf('=')
      return separator === -1 ? '***' : `${pair.slice(0, separator)}=***`
    })
    .join('&')
}

function redactUrl(rawUrl: string): string {
  const hashIndex = rawUrl.indexOf('#')
  const fragment = hashIndex === -1 ? null : rawUrl.slice(hashIndex + 1)
  const withoutFragment = hashIndex === -1 ? rawUrl : rawUrl.slice(0, hashIndex)
  const queryIndex = withoutFragment.indexOf('?')
  const query = queryIndex === -1 ? null : withoutFragment.slice(queryIndex + 1)
  const base = queryIndex === -1 ? withoutFragment : withoutFragment.slice(0, queryIndex)
  // userinfo 整段（`user:token@`）都可能是身份信息，不留用户名。
  const withUserinfo = base.replace(/\/\/[^/@\s]+@/u, '//***@')
  const queryPart = query === null ? '' : `?${redactPairs(query)}`
  const fragmentPart = fragment === null
    ? ''
    : `#${fragment.includes('=') ? redactPairs(fragment) : '***'}`
  return `${withUserinfo}${queryPart}${fragmentPart}`
}

/**
 * 其它绝对路径：不匹配 URL 里的 `//host`；只在边界（空白/引号/括号/等号/逗号/分号/冒号/行首）后起步。
 * 命中的每一段交给 `anchorOne`，于是 home、仓库内、其它路径三条规则只有一处实现。
 */
const ABSOLUTE_PATH_PATTERN =
  /(^|[\s'"(\[{=,;:])((?:\/(?!\/)[^\s'"]+)|(?:[A-Za-z]:\\{1,2}[^\s'"]+)|(?:\\\\\?\\[A-Za-z]:\\[^\s'"]+))/gu

function anchorOtherAbsolutePaths(text: string): string {
  return text.replace(ABSOLUTE_PATH_PATTERN, (_match, prefix: string, path: string) => `${prefix}${anchorOne(path)}`)
}

/** 唯一入口：原始 `error.message` 进，已脱敏的完整诊断出。 */
export function redactDiagnosticText(raw: string): string {
  // ① 凭据最先；② URL 的值（键保留）；③ home → `~/<末段>`；④ 其它绝对路径；⑤ 不截断。
  const credentialSafe = redactText(raw).text
  const urlSafe = credentialSafe.replace(URL_PATTERN, (match) => redactUrl(match))
  return anchorOtherAbsolutePaths(anchorPaths(urlSafe))
}
