/**
 * 文案解析端口（契约 §3.3）：记录里存键与参数，句子在**读的那一刻**按当前语言解析一次。
 *
 * 平台事件用平台闭集键；产品事件的键由装配层注入的产品文案表解析。平台**不 import 产品代码**：
 * 产品表由组合根传进来，这个文件只认 `NotificationCopyRef`。
 *
 * 作业名不走任何文案表——它的唯一来源是**作业定义上的 `JobTitle`**（契约 v2.40）。
 * 为此端口多认一种 scope：`{ scope: 'job-title', definitionId }`，取名字的回调也由装配层注入。
 *
 * 解析不到**不许露键、不许露 `definitionId`**：回退平台兜底句，并由调用方记 `copy-unresolved`。
 */
import type { NotificationCopyLanguage, NotificationCopyTable } from '../../i18n/notificationCopy'
import { formatNotificationNumber, type NotificationCopyNumber } from './notificationNumberFormat'

/**
 * 占位符的值：字面量，或一个**不带参数**的引用。
 *
 * 只允许一层，是刻意写进类型的：`job-title` 的入参只有 `definitionId`，`platform`/`product`
 * 在这一层的引用也不带 params。放开嵌套之后解析不可判（递归、循环、深度都没有上限），
 * 为了一个作业名不值得。
 */
export type NotificationCopyParamRef =
  | { scope: 'platform'; key: string }
  | { scope: 'product'; productId: string; key: string }
  | { scope: 'job-title'; definitionId: string }

/**
 * 参数值三种形态：字面串、一层引用、**数值+单位**（契约 v2.42 第三种）。
 *
 * 数值形态存在的原因：提交时把数字拼成句子，就把语言和格式一起拍死在数据里了。
 * 传 `{ number, kind }`，由 `formatNotificationNumber` 在**读的那一刻**按语言出「4.2 亿 / $420M」。
 */
export type NotificationCopyParam = string | { ref: NotificationCopyParamRef } | NotificationCopyNumber

/** 一句话的引用：平台键、产品键，或作业名（v2.40）。 */
export type NotificationCopyRef =
  | { scope: 'platform'; key: string; params?: Readonly<Record<string, NotificationCopyParam>> }
  | { scope: 'product'; productId: string; key: string; params?: Readonly<Record<string, NotificationCopyParam>> }
  | { scope: 'job-title'; definitionId: string }

export type NotificationCopyPort = {
  resolve: (ref: NotificationCopyRef, language: NotificationCopyLanguage) => string | null
}

/** 按 `definitionId` 取作业定义上的名字；取不到返回 `null`（调用方据此降级）。 */
export type JobTitleResolver = (definitionId: string, language: NotificationCopyLanguage) => string | null

export type NotificationCopyTableSet = Readonly<Record<NotificationCopyLanguage, Readonly<Record<string, string>>>>

type SentenceRef =
  | { scope: 'platform'; key: string }
  | { scope: 'product'; productId: string; key: string }

export function createNotificationCopyPort(input: {
  platform: Readonly<Record<NotificationCopyLanguage, NotificationCopyTable>>
  products?: Readonly<Record<string, NotificationCopyTableSet>>
  /**
   * 作业名（v2.40）：**不另建文案表**，名字的唯一来源就是作业定义那一处。
   * 缺这个端口时 `job-title` 一律解析不到——那会整条降级成兜底句，不会印出 `definitionId`。
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

  return {
    resolve(ref, language) {
      if (ref.scope === 'job-title') return nameOf(ref.definitionId, language)

      const template = sentenceOf(ref, language)
      if (template === null) return null

      let unresolved = false
      const text = template.replace(/\{(\w+)\}/gu, (placeholder, name: string) => {
        const param = ref.params?.[name]
        if (param === undefined) {
          unresolved = true
          return placeholder
        }
        if (typeof param === 'string') return param
        if ('ref' in param) {
          const resolved = resolveParamRef(param.ref, language)
          if (resolved === null) {
            unresolved = true
            return placeholder
          }
          return resolved
        }
        const formatted = formatNotificationNumber(param, language)
        if (formatted === null) {
          unresolved = true
          return placeholder
        }
        return formatted
      })
      // 参数缺失、或引用解析不到时不许把 `{taskName}` 印到读者面前：整句判为解析不到，由调用方降级。
      return unresolved || /\{\w+\}/.test(text) ? null : text
    }
  }
}
