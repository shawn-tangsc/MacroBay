const MAX_TITLE = 120

export function dailyBriefSessionTitle(input: Readonly<{
  date: string
  locale: 'zh-CN' | 'en-US'
  topic?: string
}>): string {
  const date = input.date.slice(5, 10)
  const topic = input.topic?.trim().replace(/\s+/g, ' ').slice(0, 12)
  const title = `${date} 每日简报${topic ? ` · ${topic}` : ''} · AI 编辑 · ${input.locale === 'zh-CN' ? '中文' : 'EN'}`
  return title.length <= MAX_TITLE ? title : title.slice(0, MAX_TITLE)
}

export function dailyBriefEditionKey(date: string, locale: 'zh-CN' | 'en-US'): string {
  return `${date}:${locale}`
}
