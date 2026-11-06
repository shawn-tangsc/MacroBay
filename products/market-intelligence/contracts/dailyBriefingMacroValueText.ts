/**
 * 一个宏观实际值那一格的文字（`02` v2.128）：正文、导出图、复制文本共用这一份。
 *
 * 三处各拼一遍就是三种说法：图上标了「（网页）」、复制里没有，读者核对时就对不上。
 * 所以"值 + 来源后缀"只在这里拼一次；`undefined` 表示**整格不渲染**（不是空串、不是破折号）。
 *
 * 放在 contracts 而不是渲染层：复制文本（markdown）与分享卡都要用它，反向依赖渲染层会把
 * 契约层拉进 UI。
 */
export function briefingMacroValueLabel(
  labels: Readonly<{ actual: string; webValue: string }>,
  item: Readonly<{ actual?: string; valueSource?: 'calendar' | 'web' }>
): string | undefined {
  if (item.actual === undefined) return undefined
  // 来源标注不是可信度话术：只给网页取到的值加，库内值一个字都不加。
  return `${labels.actual} ${item.actual}${item.valueSource === 'web' ? labels.webValue : ''}`
}
