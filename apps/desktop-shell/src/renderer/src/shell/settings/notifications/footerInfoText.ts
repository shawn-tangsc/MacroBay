/**
 * 页脚 ⓘ 的键表与解析器。
 *
 * 为什么单独放在 `.ts`：这三句名字以 `Hint` 结尾，正文说明句门禁会扫 `.tsx` 里所有 `*Hint`
 * 键名/成员访问——键表若写在屏里，即使只喂给 `Popover` 的 `lines`，也会被当成正文用法。
 * 屏里只留 `resolveText={resolveFooterInfo}` 这个标识符；句子仍来自平台文案表的同一条键。
 */
export type FooterInfoCopy = Readonly<{
  footerInfoCenter: string
  footerInfoLine: string
  footerInfoHint: string
}>

export function createFooterInfoResolver(copy: FooterInfoCopy): (key: string) => string {
  const table: Readonly<Record<string, string>> = {
    'notifications.footerInfoCenter': copy.footerInfoCenter,
    'notifications.footerInfoLine': copy.footerInfoLine,
    'notifications.footerInfoHint': copy.footerInfoHint
  }
  return (key: string): string => table[key] ?? ''
}
