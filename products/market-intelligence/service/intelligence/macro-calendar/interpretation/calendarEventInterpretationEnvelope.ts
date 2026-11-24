import { createHash } from 'node:crypto'

/**
 * 解读用的**冻结信封**（R36 技术方案 §4）：模型只看这一小袋事实，不读新闻全文、不读别的事件、
 * 不自己再拉数。信封里有什么，解读才被允许说什么——事实校验的允许集就是从它算出来的。
 *
 * 为什么冻结在读取时算、而不在生成后再算：同一组数（`data_key` 相同）必须给出同一个信封，
 * 否则「为什么这条解读这么说」在事后无法复核。`snapshotHash` 就是这份信封的指纹，随解读一起落库。
 */
export type CalendarInterpretationEventFacts = Readonly<{
  eventKey: string
  /** 给读者看的名字（标题或指标名）；模型只把它当上下文，不据此推断别的。 */
  title: string
  country: string
  importance: 'high' | 'medium' | 'low'
  periodKey: string
  scheduledDate: string
  scheduledAt?: string
  actual?: string
  previous?: string
  consensus?: string
  /** 来源名（`BLS` / `BEA` / `Fed`）。 */
  source: string
}>

/** 同一发布组里最近几次的读数：只用来给「这一期与上期的方向」做上下文，最多三条。 */
export type CalendarInterpretationHistoryRow = Readonly<{
  periodKey: string
  actual?: string
  previous?: string
}>

export type CalendarInterpretationEnvelope = Readonly<{
  event: Readonly<{
    key: string; title: string; country: string; importance: 'high' | 'medium' | 'low'
    period: string; releaseDate: string; releaseTime?: string; source: string
  }>
  /** 值只放展示串：源格式（`3.2%` / `165K`）本身是事实，不在这里换算。 */
  values: Readonly<{ actual?: string; previous?: string; consensus?: string }>
  /** 往期（最多 3 条，最近的在前）。为空就不带这个键，模型不该看到空数组当成「没有历史」。 */
  history?: readonly Readonly<{ period: string; actual?: string; previous?: string }>[]
}>

export const calendarInterpretationHistoryLimit = 3

export function buildCalendarInterpretationEnvelope(input: Readonly<{
  event: CalendarInterpretationEventFacts
  history: readonly CalendarInterpretationHistoryRow[]
}>): Readonly<{ envelope: CalendarInterpretationEnvelope; snapshotHash: string; evidenceScope: readonly string[] }> {
  const { event } = input
  const values = {
    ...(event.actual === undefined ? {} : { actual: event.actual }),
    ...(event.previous === undefined ? {} : { previous: event.previous }),
    ...(event.consensus === undefined ? {} : { consensus: event.consensus })
  }
  const history = input.history
    .filter((row) => row.actual !== undefined || row.previous !== undefined)
    .slice(0, calendarInterpretationHistoryLimit)
    .map((row) => ({
      period: row.periodKey,
      ...(row.actual === undefined ? {} : { actual: row.actual }),
      ...(row.previous === undefined ? {} : { previous: row.previous })
    }))
  const envelope: CalendarInterpretationEnvelope = {
    event: {
      key: event.eventKey, title: event.title, country: event.country, importance: event.importance,
      period: event.periodKey, releaseDate: event.scheduledDate,
      ...(event.scheduledAt === undefined ? {} : { releaseTime: event.scheduledAt }),
      source: event.source
    },
    values,
    ...(history.length === 0 ? {} : { history })
  }
  return {
    envelope,
    snapshotHash: createHash('sha256').update(JSON.stringify(envelope)).digest('hex'),
    // 依据范围只列**实际进了信封**的项：读者看到的「依据」不该包含没用上的字段。
    evidenceScope: [
      'event',
      ...(values.actual === undefined ? [] : ['actual']),
      ...(values.previous === undefined ? [] : ['previous']),
      ...(values.consensus === undefined ? [] : ['consensus']),
      ...(history.length === 0 ? [] : ['history'])
    ]
  }
}

/** 解读的输出语言跟读者界面走：中文界面给中文，英文界面给英文——一份行只服务一种语言。 */
export type CalendarInterpretationLocale = 'zh-CN' | 'en-US'

/**
 * 提示词只写要求，不写「遇到这些说法就判红」的句式清单（AGENTS.md「Constraining AI Output」）：
 * 事实由 `interpretationCitesOnlyEnvelopeNumbers` 在出模型之后校验，措辞交给模型。
 */
export function calendarInterpretationMessages(
  envelope: CalendarInterpretationEnvelope,
  locale: CalendarInterpretationLocale
): readonly Readonly<{ role: 'system' | 'user'; content: string }>[] {
  const language = locale === 'en-US' ? 'English' : 'Simplified Chinese'
  return [
    {
      role: 'system',
      content: [
        `You explain one macroeconomic data release to a reader of a market-intelligence app. Write in ${language}.`,
        'Use only the facts inside the JSON snapshot the user provides. Every number you mention must appear verbatim in that snapshot; never compute a new number, never recall outside facts, never mention other releases.',
        'Write 2 to 3 sentences: (1) what this reading says, (2) what it means against the expectation and the previous reading, (3) what to watch next. If the snapshot has no expectation, do not imply one.',
        'Return JSON only, shaped {"text":"..."}, with no markdown and no commentary.'
      ].join(' ')
    },
    { role: 'user', content: JSON.stringify(envelope) }
  ]
}