import { proseLanguageBreach, type BriefingProseLocale } from './dailyBriefingProseLanguage'

/**
 * 日报文档的**语言扫描器**（`04` §3.4.2）：按**渲染结果**扫，不按字段名扫。
 *
 * 为什么按叶子扫：字段清单式的校验，字段一加就漏（2026-11-02 英文期整段中文而校验是绿的，
 * 因为它只验了 `summary`）。递归遍历文档里的每一个字符串，新增字段自动进扫描，扫描器一行不用改。
 *
 * **接口（B2 若换手，照这个接）**
 * - `briefingTextLeaves(document)`：`unknown` → `readonly { path, text }[]`。`path` 是稳定的点/下标路径
 *   （`conclusion.summary`、`news.items[2].title`），用来点名。
 * - `briefingTextBreaches({ document, locale, sourceTexts })`：返回命中的叶子（`{ path, text }`）。
 *   `sourceTexts` 是**来源数据**的原样串（新闻原文、事件名、来源名、URL、数字），命中的叶子若
 *   与其中任一条逐字相同（互为子串）就放行——那是引用，不是模型自己写的语言。
 * - 判定只用一个函数 `proseLanguageBreach`（`dailyBriefingProseLanguage.ts`），**不造第二套阈值**。
 *
 * **只回答"哪些叶子有问题"**，不决定拒发还是改写——那是 B2 的事。
 */

export type BriefingTextLeaf = Readonly<{ path: string; text: string }>

export type BriefingTextScanInput = Readonly<{
  document: unknown
  locale: BriefingProseLocale
  /** 本次输入里原样存在的数据串；与被扫文本互为子串即视为引用，放行。 */
  sourceTexts?: readonly string[]
}>

/** 递归收集每一个字符串叶子，按路径记录。数组用下标、对象用键名，路径不含类型前缀。 */
export function briefingTextLeaves(document: unknown): readonly BriefingTextLeaf[] {
  const leaves: BriefingTextLeaf[] = []
  const walk = (value: unknown, path: string): void => {
    if (typeof value === 'string') {
      leaves.push({ path, text: value })
      return
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, path === '' ? `[${index}]` : `${path}[${index}]`))
      return
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        walk(entry, path === '' ? key : `${path}.${key}`)
      }
    }
  }
  walk(document, '')
  return leaves
}

/** 命中的叶子：语言不对、且不是来源数据的逐字引用。 */
export function briefingTextBreaches(input: BriefingTextScanInput): readonly BriefingTextLeaf[] {
  const sourceTexts = (input.sourceTexts ?? []).map((text) => text.trim()).filter((text) => text.length > 0)
  return briefingTextLeaves(input.document).filter((leaf) => {
    const text = leaf.text.trim()
    if (text.length === 0) return false
    if (!proseLanguageBreach(text, input.locale)) return false
    // 引用放行：与来源数据互为子串（新闻原文可能带着引号/前后缀出现在正文里）。
    return !sourceTexts.some((source) => source.includes(text) || text.includes(source))
  })
}
