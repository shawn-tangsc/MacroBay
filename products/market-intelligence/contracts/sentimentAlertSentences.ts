/**
 * N10「舆情强度到门槛」的成品句子。**唯一一份措辞**：文案表里的模板与提交请求里的成品
 * 都从这里取，避免「表里一套、请求里一套」的两份写法。
 *
 * 三块固定：标题【强度】原文标题 / 正文来源 / 一句「为什么推给你」。
 * 正文**刻意不含链接**：中心靠「看原文」按钮、手机靠平台在推送末尾附一行
 * （`formatPushText(content, externalUrl?)`）；拼进正文会让中心那条被两行截断。
 */
export type SentimentAlertLocale = 'zh-CN' | 'en-US'

export type SentimentAlertStrength = 'high' | 'medium' | 'low'

export type SentimentAlertTemplates = Readonly<{
  title: string
  bodyWithSource: string
  reason: string
  strength: Readonly<Record<SentimentAlertStrength, string>>
}>

export const sentimentAlertTemplates: Readonly<Record<SentimentAlertLocale, SentimentAlertTemplates>> = Object.freeze({
  'zh-CN': Object.freeze({
    // 中文用全角方括号；英文用半角，两边不共用一份模板（写死一半就会有一边排版错）。
    title: '【{strength}】{headline}',
    bodyWithSource: '来源：{sourceName}',
    reason: '分析给出的强度达到了收推送的门槛。',
    // 最弱档是「弱」，它的反面就是「强」——与应用里 `strengthLevels` 用同一组词（`productText`
    // 中英两侧），否则手机上写【高】、进应用找不到「高」字，同一件事两种说法。
    strength: Object.freeze({ high: '强', medium: '中', low: '弱' })
  }),
  'en-US': Object.freeze({
    title: '[{strength}] {headline}',
    bodyWithSource: 'Source: {sourceName}',
    reason: 'The analysis rated this high enough to reach your phone.',
    strength: Object.freeze({ high: 'Strong', medium: 'Medium', low: 'Weak' })
  })
})

/** 把模板填成成品；模板里没有的占位符原样留着（宁可看出来，也不悄悄吞掉）。 */
export function fillSentimentTemplate(template: string, vars: Readonly<Record<string, string>>): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (whole, key: string) => (key in vars ? vars[key]! : whole))
}

export type SentimentAlertSentences = Readonly<{ title: string; body: string; reason: string }>

export function renderSentimentAlert(input: {
  locale: SentimentAlertLocale
  strength: SentimentAlertStrength
  /** 新闻原标题：**数据**，不翻译、不改写、不做句首大写。 */
  headline: string
  /** 来源显示名：**数据**。缺它就不用这个函数——没来源的条目不该提交。 */
  sourceName: string
}): SentimentAlertSentences {
  const templates = sentimentAlertTemplates[input.locale]
  const vars = {
    strength: templates.strength[input.strength],
    headline: input.headline,
    sourceName: input.sourceName
  }
  return {
    title: fillSentimentTemplate(templates.title, vars),
    body: fillSentimentTemplate(templates.bodyWithSource, vars),
    reason: templates.reason
  }
}
