/**
 * 模型选择器的模糊匹配（唯一实现；选择器与 `@` 提及面板共用）。
 *
 * 匹配模型名 / 模型 id / 厂商名，大小写无关：
 *  1. 原样子串（含分隔符）；
 *  2. 去掉分隔符后子串（`deepseek v3` ⇔ `deepseek-v3`）；
 *  3. 去掉分隔符后按顺序命中字符（`dsv3` ⇒ `deepseek-ai/DeepSeek-V3`）。
 * 长度 ≤ 2 的关键字只做前两步，避免过松的命中。
 */
export function matchesModelPickerQuery(searchText: string, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return true
  const text = searchText.toLowerCase()
  if (text.includes(needle)) return true
  const compactNeedle = compactModelPickerText(needle)
  if (compactNeedle.length === 0) return true
  const compactText = compactModelPickerText(text)
  if (compactText.includes(compactNeedle)) return true
  if (compactNeedle.length <= 2) return false
  return isSubsequence(compactNeedle, compactText)
}

export function compactModelPickerText(value: string): string {
  return value.replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
}

function isSubsequence(needle: string, text: string): boolean {
  let cursor = 0
  for (const character of text) {
    if (character === needle[cursor]) cursor += 1
    if (cursor === needle.length) return true
  }
  return false
}
