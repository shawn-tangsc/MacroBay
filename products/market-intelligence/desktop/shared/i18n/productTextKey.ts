import { useMemo } from 'react'

import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from './productText'

/**
 * 产品文案的「点分键 → 句子」解析器——**全产品一处**。
 *
 * 为什么需要它：平台组件（`IconButton` 的 `ariaLabelKey`、`StateView` 的文案）只收**键**，
 * 句子由调用方解析。产品文案是嵌套对象，没有点分路径查找；而把已解析的句子塞进
 * `resolveText={() => sentence}` 等于让键形同虚设——守卫查得到键的形状，查不到它没有意义。
 *
 * 两条钉死的规矩：
 * - 表**从现有中英两套嵌套对象展平而来**，不手写第二张映射表，否则文案会出现第二个出处；
 * - **未知键返回空串，不回退成键名**（同 `ui.state.*`）：回退会把 `analysisDrawer.close`
 *   这种内部代号念给读屏用户听。
 */

export type ProductTextLanguage = keyof typeof productText

function flatten(node: unknown, prefix: string, into: Map<string, string>): void {
  if (typeof node === 'string') {
    into.set(prefix, node)
    return
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => flatten(item, `${prefix}.${index}`, into))
    return
  }
  if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      flatten(value, prefix === '' ? key : `${prefix}.${key}`, into)
    }
  }
}

function flattenLanguage(language: ProductTextLanguage): ReadonlyMap<string, string> {
  const into = new Map<string, string>()
  flatten(productText[language], '', into)
  return into
}

const TABLES: Record<ProductTextLanguage, ReadonlyMap<string, string>> = {
  'zh-CN': flattenLanguage('zh-CN'),
  'en-US': flattenLanguage('en-US')
}

/** 已展平的键（测试与守卫用；生产代码按需查 `resolveProductTextKey`）。 */
export function productTextKeys(language: ProductTextLanguage): ReadonlySet<string> {
  return new Set(TABLES[language].keys())
}

export function resolveProductTextKey(language: ProductTextLanguage, key: string): string {
  const table = TABLES[language]
  if (!table) return ''
  return table.get(key) ?? ''
}

/** 绑定当前壳层语言；组件里直接 `const resolve = useProductTextKey()`。 */
export function useProductTextKey(): (key: string) => string {
  const language = useShellLanguage()
  return useMemo(() => (key: string) => resolveProductTextKey(language, key), [language])
}
