import type { AppLanguage } from '@platform/settings/schema/appSettings'

import { platformText, type PlatformText } from './platformText'

/**
 * `assistants` 文案表的**路径 → 句子**解析器。
 *
 * 为什么不是另一张键表：句子已经在 `PlatformText['assistants']` 里，另起一张表就是同一句话
 * 两份出处。路径由类型从表本身递归推导（`Path<T>`），写错一段编译不过；运行时未知路径返回
 * 空串，不回退成路径名——键名上屏是最糟的一种。
 *
 * 与 `resolveAgentTextKey` / `useProductTextKey` 同形：解析器只做「按键路径逐段取值」，
 * 不做 kebab→camel 之类的改名。
 */
export type Path<T> = T extends string
  ? ''
  : T extends (...args: never[]) => unknown
    ? never
    : T extends readonly unknown[]
      ? never
      : {
          [K in keyof T & string]: Path<T[K]> extends ''
            ? K
            : Path<T[K]> extends never
              ? never
              : `${K}.${Path<T[K]>}`
        }[keyof T & string]

export type AssistantsTextPath = Path<PlatformText['assistants']>

/** 任意子树通用：按键路径逐段取值；未知路径返回空串。 */
export function resolveTextPath<T>(table: T, path: Path<T>): string {
  let current: unknown = table
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return ''
    current = (current as Record<string, unknown>)[segment]
  }
  return typeof current === 'string' ? current : ''
}

/** `assistants` 整棵表：路径相对 `PlatformText['assistants']`。 */
export function resolveAssistantsText(
  assistants: PlatformText['assistants'],
  path: AssistantsTextPath
): string {
  return resolveTextPath(assistants, path)
}

/** 供测试与守卫用：某语言下的整棵 `assistants` 表（不导出语言表本身）。 */
export function assistantsTextFor(language: AppLanguage): PlatformText['assistants'] {
  return platformText[language].assistants
}
