import type { NotificationContentByLanguage } from '@platform/notifications/contracts/notificationContracts'

/**
 * 源头拼句子的两个零件（契约 v2.56）。
 *
 * 信号与宏观各有一张骨架表，但「把槽填满」「中英各一份」这两件事只写一次：两处各写一遍，
 * 迟早一处允许留半句、另一处不许，而读者看到的是同一块屏幕。
 */

export type SentenceLanguage = 'zh-CN' | 'en-US'

export type SentenceParts = Readonly<{ title: string; body: string; reason: string }>

/**
 * 把模板里的槽全部换掉。
 *
 * `null` / `undefined` 表示**这一格没有了** → 整条作废（返回 `undefined`）：半句真话比不说更糟。
 * 空串是**合法的空**——口径括号认不出时本来就该什么都没有，不能因此把整句毙掉。
 */
export function fillTemplate(
  template: string,
  values: Readonly<Record<string, string | null>>
): string | undefined {
  let missing = false
  const text = template.replace(/\{(\w+)\}/gu, (_placeholder, name: string) => {
    const value = values[name]
    if (typeof value !== 'string') {
      missing = true
      return ''
    }
    return value
  })
  return missing ? undefined : text
}

/**
 * 中英各拼一份。**只给一份就会把语言钉死在提交那一刻**——读者切换语言后，历史通知不会变。
 * 任一份拼不出来就整条不提交：那是源头没拼完，不是平台该替它降级。
 */
export function composeBothLanguages(
  build: (language: SentenceLanguage) => SentenceParts | undefined
): NotificationContentByLanguage | undefined {
  const zh = build('zh-CN')
  const en = build('en-US')
  if (zh === undefined || en === undefined) return undefined
  return { 'zh-CN': zh, 'en-US': en }
}
