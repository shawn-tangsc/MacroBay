import type { AppLanguage } from '../../settings/schema/appSettings'
import type { LocalizedText } from '../../product-manifest'

/**
 * 作业名：内置作业是**双语**，读者自己建的任务是**一句原文、永不翻译**（契约
 * `docs-private/10-development/job-title-localization-contract.md`）。
 *
 * `{ literal }` 之所以要有自己的一支，是为了让「这是读者自己的字」在类型上看得见——
 * 两个语言都填同一句能跑，但半年后一定有人给它补英译，而那种事编译器该从一开始就说不。
 */
export type JobTitle =
  | LocalizedText
  | { literal: string }
  /**
   * **临时支：代表「还没迁移」，不是「翻译好了」。**
   *
   * 存量 24 条内置作业名仍是英文句子；中文界面显示英文就是今天的行为，不是新债。
   * 阶段 3 会删掉这一支——删掉之后缺一条翻译就编译不过（契约 §7）。
   */
  | string

/**
 * `titleParams` 的值必须是**读者能在界面上看到的东西**（产品名、通道名），不能是 `handlerId` 这类工程名。
 *
 * 值本身也可以是双语的（通道名在中文界面叫「飞书」、英文界面叫「Lark」）：**在渲染那一刻按语言取**，
 * 不预解析、不冻结——否则切语言后参数还是旧语言，正是今晚修过的那类病。
 */
export type JobTitleParams = Record<string, string | LocalizedText>

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
  return text.replace(PLACEHOLDER, (_match, key: string) => {
    const value = params[key]
    if (value === undefined) return ''
    return typeof value === 'string' ? value : value[language]
  })
}

/**
 * 给**只能放字符串**的地方用的单点转换：运行记录、名称过滤这类机器侧快照。
 *
 * 它**故意不按界面语言选**：运行记录是历史快照，存进去时用哪个语言，之后切语言也不会变；
 * 按语言选会让「历史」跟着界面走。界面上的名字不从这里取——那里用 `resolveJobTitle`。
 */
export function jobTitleText(title: JobTitle): string {
  if (typeof title === 'string') return title
  if ('literal' in title) return title.literal
  return title['en-US']
}
