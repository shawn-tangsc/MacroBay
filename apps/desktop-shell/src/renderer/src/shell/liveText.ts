import type { PlatformText } from '../i18n/platformText'

/**
 * 一段**以当前语言为准**的提示：存「怎么生成这句话」，不存生成好的句子。
 *
 * 为什么：状态里存解析好的字符串，语言就被冻结在它产生的那一刻——实测过切到英文后
 * 设置页右上角还写着「已保存」，切回中文又变成 "Saved"。存函数之后，渲染时才取当前语言，
 * 历史提示也跟着界面语言一起变。
 */
export type LiveText<T> = (current: T) => string

export type PlatformLiveText = LiveText<PlatformText>

/** 渲染期解析：`null` 原样返回，调用点不必自己判空。 */
export function resolveLiveText<T>(live: LiveText<T> | null, current: T): string | null {
  return live === null ? null : live(current)
}
