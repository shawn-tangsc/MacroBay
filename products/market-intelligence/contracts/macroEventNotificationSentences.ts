/**
 * 宏观落地通知的句子骨架（契约 v2.56「源头拼成品」）。
 *
 * **只有这一份字符串**：源头拼成品读它，桌面文案表（旧记录「键 + 参数」的读取路径）也从它取值。
 * 指标名不在这里——它只有一处来源（`contracts/indicatorNames.ts`），两边都从那里取。
 *
 * 三条硬规矩写进这张表：
 * - **数值原样**：`displayValue` 是源站写的串（`3.1%` / `1.2M` / `3.4`），槽里只放原文，不重排；
 * - **国家走代码**：表里有就翻，没有就显示代码本身（`JP`），**不许留空、不许用源站 `countryName`**；
 * - **口径认得出才写**：`yoy` / `mom` 各一个括号，认不出就是空串，不会出现 `（）`。
 */

export type MacroEventBodyVariant = 'values' | 'noPrevious' | 'noForecast'

export type MacroEventLanguageSheet = Readonly<{
  title: string
  /** 方向是**数值方向**，不是好坏。 */
  direction: Readonly<Record<'above' | 'below', string>>
  /**
   * 国家代码表只放**这条通知今天真的会出现**的国家：筛选写死了美国
   * （`qualifyingCountryCode`），其余代码一律按代码本身显示。
   */
  country: Readonly<Record<string, string>>
  body: Readonly<Record<MacroEventBodyVariant, string>>
  periodicity: Readonly<Record<'yoy' | 'mom', string>>
  reason: string
}>

export const macroEventNotificationSentences: Readonly<
  Record<'zh-CN' | 'en-US', MacroEventLanguageSheet>
> = Object.freeze({
  'zh-CN': Object.freeze({
    title: '{country} {indicator} {direction}',
    direction: Object.freeze({ above: '高于预期', below: '低于预期' }),
    country: Object.freeze({ US: '美国' }),
    body: Object.freeze({
      values: '实际 {actual}，预期 {consensus}，前值 {previous}{periodLabel}',
      noPrevious: '实际 {actual}，预期 {consensus}，前值没有公布{periodLabel}',
      // 今天不可达：筛选要求可比的一对才提交。留着骨架，是为了缺预期那天不必再改结构。
      noForecast: '实际 {actual}，这次没有预期值可比{periodLabel}'
    }),
    periodicity: Object.freeze({ yoy: '（同比）', mom: '（环比）' }),
    reason: '读数达到这条规则的意外阈值。'
  }),
  'en-US': Object.freeze({
    title: '{country} {indicator} {direction}',
    direction: Object.freeze({ above: 'above forecast', below: 'below forecast' }),
    country: Object.freeze({ US: 'US' }),
    body: Object.freeze({
      values: 'Actual {actual} vs {consensus} forecast; previous {previous}{periodLabel}',
      noPrevious: 'Actual {actual} vs {consensus} forecast; no previous release{periodLabel}',
      noForecast: 'Actual {actual}; no forecast to compare{periodLabel}'
    }),
    periodicity: Object.freeze({ yoy: ' (YoY)', mom: ' (MoM)' }),
    reason: 'The reading crossed this rule’s surprise threshold.'
  })
})
