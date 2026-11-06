/**
 * 文案解析端口（契约 §3.3）：记录里存键与参数，句子在**读的那一刻**按当前语言解析一次。
 *
 * 平台事件用平台闭集键；产品事件的键由装配层注入的产品文案表解析。平台**不 import 产品代码**：
 * 产品表由组合根传进来，这个文件只认 `NotificationCopyRef`。
 *
 * 作业名不走任何文案表——它的唯一来源是**作业定义上的 `JobTitle`**（契约 v2.40）。
 * 但历史记录跨天读，作业可能已经停用（定义没了），所以 v2.49 起新提交**一律用快照**
 * （`{ snapshot: { 'zh-CN', 'en-US' } }`），`job-title` 这个 scope 只留读取兼容。
 *
 * **分级降级（v2.48）**：只有**模板本身**没供上才整条兜底；模板在、参数取不到 → **只让那一格消失**
 * （连同前导分隔符、成对括号），其余照常。两个诊断码不混：模板缺 → `copy-unresolved`，
 * 参数缺 → `copy-param-missing`（带参数名）。
 *
 * **数字例外（v2.50）**：数字参数取不到时**整句作废**，不是只去掉那一格。
 *
 * 「只去掉那一格」对名字成立（`任务失败：{taskName}` → `任务失败`，句子还完整），对数字不成立：
 * `成交放大 {multiple}，规模约 {notional}` 去掉数字剩 `成交放大，规模约 …`——语法断裂，而且
 * 读者会以为**没有放大**。这是半句真话，比不说更糟。所以读者的标题降级成兜底句，正文留空，
 * 运行记录里留下 `copy-param-missing` 与参数名。
 */
import type { NotificationCopyLanguage, NotificationCopyTable } from '../../i18n/notificationCopy'
import { formatNotificationNumber, type NotificationCopyNumber } from './notificationNumberFormat'

/**
 * 占位符的值：字面量、一层引用、数值+单位，或**双语快照**（v2.49）。
 *
 * 只允许一层，是刻意写进类型的：`job-title` 的入参只有 `definitionId`，`platform`/`product`
 * 在这一层的引用也不带 params。放开嵌套之后解析不可判（递归、循环、深度都没有上限）。
 */
export type NotificationCopyParamRef =
  | { scope: 'platform'; key: string }
  | { scope: 'product'; productId: string; key: string }
  /** 历史记录兼容用；新提交禁用（v2.49 起生产者改传快照）。 */
  | { scope: 'job-title'; definitionId: string }

/** 双语快照：提交那一刻的事实，读取端不再查注册表。两种语言都存。 */
export type NotificationCopySnapshot = { 'zh-CN': string; 'en-US': string }

export type NotificationCopyParam =
  | string
  | { ref: NotificationCopyParamRef }
  | NotificationCopyNumber
  | { snapshot: NotificationCopySnapshot }

/** 一句话的引用：平台键、产品键，或作业名（v2.40，历史兼容）。 */
export type NotificationCopyRef =
  | { scope: 'platform'; key: string; params?: Readonly<Record<string, NotificationCopyParam>> }
  | { scope: 'product'; productId: string; key: string; params?: Readonly<Record<string, NotificationCopyParam>> }
  | { scope: 'job-title'; definitionId: string }

export type NotificationCopyResolution = {
  /** `null` = **模板本身**没供上（整条兜底）；参数缺了不算，返回的是去掉那一格的句子。 */
  text: string | null
  /** 这次解析里消失的参数名（诊断用，`copy-param-missing`）。 */
  missingParams: readonly string[]
}

export type NotificationCopyPort = {
  resolve: (ref: NotificationCopyRef, language: NotificationCopyLanguage) => string | null
  /** 带诊断的解析：调用方据此记 `copy-param-missing`，**不新增第三个码**。 */
  resolveDetailed: (ref: NotificationCopyRef, language: NotificationCopyLanguage) => NotificationCopyResolution
}

/** 按 `definitionId` 取作业定义上的名字；取不到返回 `null`（调用方据此降级）。 */
export type JobTitleResolver = (definitionId: string, language: NotificationCopyLanguage) => string | null

export type NotificationCopyTableSet = Readonly<Record<NotificationCopyLanguage, Readonly<Record<string, string>>>>

type SentenceRef =
  | { scope: 'platform'; key: string }
  | { scope: 'product'; productId: string; key: string }

/**
 * 参数被丢掉时留下的记号。用不可见字符而不是空串，是为了在拼接后**精确删掉它前面的分隔符**
 * 或包着它的那对括号：`任务失败：{taskName}` → `任务失败`，而不是 `任务失败：`。
 */
const SLOT_DROP = '\u0000'

export function createNotificationCopyPort(input: {
  platform: Readonly<Record<NotificationCopyLanguage, NotificationCopyTable>>
  products?: Readonly<Record<string, NotificationCopyTableSet>>
  /**
   * 作业名（v2.40）：**不另建文案表**，名字的唯一来源就是作业定义那一处。
   * v2.49 起只服务历史记录的读取兼容；新提交用快照。
   */
  jobTitle?: JobTitleResolver
}): NotificationCopyPort {
  const sentenceOf = (ref: SentenceRef, language: NotificationCopyLanguage): string | null => {
    const table = (ref.scope === 'platform'
      ? input.platform[language]
      : input.products?.[ref.productId]?.[language]) as Readonly<Record<string, string>> | undefined
    const template = table?.[ref.key]
    return typeof template === 'string' && template.trim().length > 0 ? template : null
  }

  const nameOf = (definitionId: string, language: NotificationCopyLanguage): string | null => {
    const name = input.jobTitle?.(definitionId, language) ?? null
    return name !== null && name.trim().length > 0 ? name : null
  }

  const resolveParamRef = (ref: NotificationCopyParamRef, language: NotificationCopyLanguage): string | null =>
    ref.scope === 'job-title' ? nameOf(ref.definitionId, language) : sentenceOf(ref, language)

  /** 快照按当前语言取；**缺那种语言就是缺参**，绝不拿另一种语言顶上（顶上就是语言对不上）。 */
  const snapshotText = (
    snapshot: NotificationCopySnapshot | undefined,
    language: NotificationCopyLanguage
  ): string | null => {
    const value = snapshot?.[language]
    return typeof value === 'string' && value.trim().length > 0 ? value : null
  }

  function resolveDetailed(ref: NotificationCopyRef, language: NotificationCopyLanguage): NotificationCopyResolution {
    if (ref.scope === 'job-title') {
      const name = nameOf(ref.definitionId, language)
      return name === null ? { text: null, missingParams: [] } : { text: name, missingParams: [] }
    }

    const template = sentenceOf(ref, language)
    if (template === null) return { text: null, missingParams: [] }

    const missingParams: string[] = []
    let invalidNumber = false
    const text = template.replace(/\{(\w+)(\??)\}/gu, (placeholder, name: string) => {
      const param = ref.params?.[name]
      const missing = (): string => {
        missingParams.push(name)
        return SLOT_DROP
      }
      if (param === undefined) return missing()
      if (typeof param === 'string') return param
      if ('snapshot' in param) {
        const snapshot = snapshotText(param.snapshot, language)
        return snapshot === null ? missing() : snapshot
      }
      if ('ref' in param) {
        const resolved = resolveParamRef(param.ref, language)
        return resolved === null ? missing() : resolved
      }
      const formatted = formatNotificationNumber(param, language)
      // 数字与名字不同：它不是可分离的一格，它是被说的那个量。缺了就不能只说半句。
      if (formatted === null) {
        invalidNumber = true
        missingParams.push(name)
        return SLOT_DROP
      }
      return formatted
    })
    if (invalidNumber) return { text: null, missingParams }
    const settled = dropSlots(text)
    // 兜底只剩一种情况：替换后还残留占位符——那是模板本身写坏了，不是数据没到。
    if (/\{\w+\??\}/.test(settled)) return { text: null, missingParams }
    return { text: settled, missingParams }
  }

  return {
    resolve(ref, language) {
      return resolveDetailed(ref, language).text
    },
    resolveDetailed
  }
}

/** 删掉「被丢掉的格子」留下的痕迹：整对括号、前导分隔符、句首空格。 */
function dropSlots(text: string): string {
  return text
    // 整体在一对括号里（`（{x}）` / `({x})`）：整对一起消失，不留空括号。
    .replace(/[（(]\s*\u0000\s*[）)]/gu, '')
    .replace(/[：:，,、·]?\s*\u0000/gu, '')
    .replace(/\u0000/gu, '')
    // 段落在句首时，删掉它别留下一个前导空格。
    .replace(/^\s+/u, '')
}
