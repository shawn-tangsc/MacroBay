const MAX_TITLE = 120

export type DailyBriefLocale = 'zh-CN' | 'en-US'

/**
 * Copy the editor session shows its reader. The agent's working prompts stay in English; only the
 * title, the visible task line, the fact card and the field answers follow the edition language.
 */
const SESSION_COPY = {
  'zh-CN': {
    title: '每日简报', editor: 'AI 编辑', editionLocale: '中文',
    startTask: '生成 {date} 每日简报编辑层：从候选中决定展示项，并写导语、why 与焦点情景。',
    firstTask: '任务 1/2：先选事件、焦点和需要补齐的字段。',
    window: '窗口 {start} → {end}',
    macroCandidates: '宏观候选 {count}：{items}',
    newsCandidates: '舆情候选 {count}：{items}',
    data: '数据：{items}',
    leverage: '杠杆：BTC OI {btc} · ETH OI {eth}',
    policyPath: '利率路径：{probability}% {outcome} {meetingDate}',
    conclusion: '结论：{summary}',
    next: '今日要看的：{items}',
    macroFact: '{title}：实际 {actual} / 预期 {consensus} / 前值 {previous}',
    nextFact: '{title}（{at}{country}）',
    factsLabel: '日报输入事实',
    empty: '无',
    missing: '未收录',
    unknownRequest: '未命名请求，未收录。',
    listSeparator: '；',
    fieldSeparator: ' · '
  },
  'en-US': {
    title: 'Daily brief', editor: 'AI editor', editionLocale: 'EN',
    startTask: 'Generate the {date} daily brief editorial layer: choose what to show from the candidates, then write the lede, whys and focus scenario.',
    firstTask: 'Task 1/2: pick the events, the focus and the fields to fill in.',
    window: 'Window {start} → {end}',
    macroCandidates: 'Macro candidates {count}: {items}',
    newsCandidates: 'News candidates {count}: {items}',
    data: 'Data: {items}',
    leverage: 'Leverage: BTC OI {btc} · ETH OI {eth}',
    policyPath: 'Rate path: {probability}% {outcome} {meetingDate}',
    conclusion: 'Conclusion: {summary}',
    next: 'Watch today: {items}',
    macroFact: '{title}: actual {actual} / consensus {consensus} / previous {previous}',
    nextFact: '{title} ({at}{country})',
    factsLabel: 'Daily brief facts',
    empty: 'none',
    missing: 'not collected',
    unknownRequest: 'Unnamed request; nothing collected.',
    listSeparator: '; ',
    fieldSeparator: ' · '
  }
} as const

export type DailyBriefSessionCopy = (typeof SESSION_COPY)[DailyBriefLocale]

export function dailyBriefSessionCopy(locale: DailyBriefLocale): DailyBriefSessionCopy {
  return SESSION_COPY[locale]
}

/** Fills `{name}` placeholders in one of the session templates. */
export function dailyBriefSessionCopyText(template: string, values: Readonly<Record<string, string>>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), template)
}

export function dailyBriefSessionTitle(input: Readonly<{
  date: string
  locale: DailyBriefLocale
  topic?: string
}>): string {
  const date = input.date.slice(5, 10)
  const topic = input.topic?.trim().replace(/\s+/g, ' ').slice(0, 12)
  const copy = dailyBriefSessionCopy(input.locale)
  const title = `${date} ${copy.title}${topic ? ` · ${topic}` : ''} · ${copy.editor} · ${copy.editionLocale}`
  return title.length <= MAX_TITLE ? title : title.slice(0, MAX_TITLE)
}

export function dailyBriefEditionKey(date: string, locale: DailyBriefLocale): string {
  return `${date}:${locale}`
}
