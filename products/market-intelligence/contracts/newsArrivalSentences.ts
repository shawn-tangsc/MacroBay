/**
 * 新抓到舆情那条桌面通知的**成品句子**（R40 §6）：文案表里的模板与提交请求里的成品都从这里取，
 * 与 `sentimentAlertSentences` 同一姿态——措辞只写一份，不出现「表里一套、请求里一套」。
 *
 * 两行固定：
 * - 标题 `{来源名} · {条目标题}`——一眼看出哪个源、什么事；过长截断，但**源与主体必须都在**；
 * - 正文 `{偏向} · {发布时间}`——偏向取已出的判定（没有判定就不发，所以这里不会出现「判定中」）。
 *
 * 偏向词与卡片列表上那几个小字**逐词相同**（`偏多/偏空/中性/分歧`）：同一档两处写法不同，
 * 读者会以为是两件事（判据在 `newsSentimentTierWords.test.ts`）。
 */
export type NewsArrivalLocale = 'zh-CN' | 'en-US'

/** 与 `NewsPolarity` 同一闭集；本文件不 import 服务层类型，避免契约反向依赖实现。 */
export type NewsArrivalPolarity = 'bullish' | 'bearish' | 'neutral' | 'mixed'

export type NewsArrivalTemplates = Readonly<{
  title: string
  body: string
  reason: string
  polarity: Readonly<Record<NewsArrivalPolarity, string>>
  /** 发布时间落不出来时的空位（句子要成句，不留 `{time}` 这种原文）。 */
  timeFallback: string
}>

export const newsArrivalTemplates: Readonly<Record<NewsArrivalLocale, NewsArrivalTemplates>> = Object.freeze({
  'zh-CN': Object.freeze({
    title: '{sourceName} · {headline}',
    body: '{polarity} · {time}',
    reason: '这条新闻判出的强度不低，所以提醒你一下。',
    polarity: Object.freeze({ bullish: '偏多', bearish: '偏空', neutral: '中性', mixed: '分歧' }),
    timeFallback: '时间未知'
  }),
  'en-US': Object.freeze({
    title: '{sourceName} · {headline}',
    body: '{polarity} · {time}',
    reason: 'This story was rated at least medium strength, so you are being told about it.',
    polarity: Object.freeze({ bullish: 'Bullish', bearish: 'Bearish', neutral: 'Neutral', mixed: 'Mixed' }),
    timeFallback: 'time unknown'
  })
})

/** 标题里条目标题最多留多少字：源名占了前半段，再长读者一眼读不完（整句仍然成句）。 */
export const NEWS_ARRIVAL_HEADLINE_LIMIT = 60

export function fillNewsArrivalTemplate(template: string, vars: Readonly<Record<string, string>>): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (whole, key: string) => (key in vars ? vars[key]! : whole))
}

/**
 * 读者时区里的 `MM-DD HH:mm`。两件事有出处：**读者可见的时刻跟着设置时区**，格式只在一处拼。
 * 落不出来（非法时刻 / 非法时区）返回空串，由调用方用兜底词成句——不印一个编出来的时刻。
 */
export function readerTimeLabel(publishedAt: string, timeZone: string): string {
  const parsed = Date.parse(publishedAt)
  if (!Number.isFinite(parsed)) return ''
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date(parsed))
    const read = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? ''
    const month = read('month')
    const day = read('day')
    const hour = read('hour')
    const minute = read('minute')
    if (!month || !day || !hour || !minute) return ''
    // `hour12: false` 在部分运行时把午夜写成 24——统一折成 00，读者不该看到 24:05。
    return `${month}-${day} ${hour === '24' ? '00' : hour}:${minute}`
  } catch {
    return ''
  }
}

export type NewsArrivalSentences = Readonly<{ title: string; body: string; reason: string }>

export function renderNewsArrival(input: {
  locale: NewsArrivalLocale
  /** 条目标题：**数据**，不翻译、不改写。 */
  headline: string
  /** 来源显示名：**数据**；缺它就不用这个函数（没来源的通知说不清「哪来的」）。 */
  sourceName: string
  polarity: NewsArrivalPolarity
  publishedAt: string
  /** 读者时区（设置里那个，不是机器时区）。 */
  timeZone: string
}): NewsArrivalSentences | undefined {
  const templates = newsArrivalTemplates[input.locale]
  const headline = truncateHeadline(input.headline.trim())
  const sourceName = input.sourceName.trim()
  if (!headline || !sourceName) return undefined
  const time = readerTimeLabel(input.publishedAt, input.timeZone) || templates.timeFallback
  const vars = {
    sourceName,
    headline,
    polarity: templates.polarity[input.polarity],
    time
  }
  return {
    title: fillNewsArrivalTemplate(templates.title, vars),
    body: fillNewsArrivalTemplate(templates.body, vars),
    reason: templates.reason
  }
}

/** 截断只截条目标题，**源名不截**：读者至少要能认出「哪个源、什么事」。 */
function truncateHeadline(headline: string): string {
  if (headline.length <= NEWS_ARRIVAL_HEADLINE_LIMIT) return headline
  return `${headline.slice(0, NEWS_ARRIVAL_HEADLINE_LIMIT - 1)}…`
}
