import type { AppLanguage } from '../../settings/schema/appSettings'
import type { LocalizedText } from '../../product-manifest'

/**
 * 作业名：内置作业是**双语**，读者自己建的任务是**一句原文、永不翻译**（契约
 * `docs-private/10-development/job-title-localization-contract.md`）。
 *
 * `{ literal }` 之所以要有自己的一支，是为了让「这是读者自己的字」在类型上看得见——
 * 两个语言都填同一句能跑，但半年后一定有人给它补英译，而那种事编译器该从一开始就说不。
 */
export type JobTitle = LocalizedText | { literal: string }

/** `titleParams` 的值必须是**读者能在界面上看到的东西**（产品名、通道名），不能是 `handlerId` 这类工程名。 */
export type JobTitleParams = Record<string, string>

/** 词表里的占位符写法；只认这一处实现，消费点不许各自 `replace`。 */
const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g

/**
 * 唯一的解析入口：给当前语言挑一条，替换占位符，`{ literal }` 原样返回。
 *
 * 三条刻意的取舍：
 * - **不回落**：某个语言缺一条就是数据错误（类型上两语言必填），这里不拿另一种语言顶上——
 *   静默回落会把「漏翻译」变成永久隐形（架构师 2026-11-05 判）。
 * - **不回落成键名/占位符**：参数缺值就留空，而不是把 `{name}` 印给读者。
 * - **收 `string` 只是迁移窗口**：存量注册点还是英文句子；类型翻成 `JobTitle` 的那一笔由各产品线
 *   填名同批完成，之后这个 `string` 分支就没有调用者了。
 */
export function resolveJobTitle(
  title: JobTitle | string,
  params: JobTitleParams | undefined,
  language: AppLanguage
): string {
  const text = typeof title === 'string'
    ? title
    : 'literal' in title
      ? title.literal
      : title[language]

  if (params === undefined) return text
  return text.replace(PLACEHOLDER, (_match, key: string) => params[key] ?? '')
}
