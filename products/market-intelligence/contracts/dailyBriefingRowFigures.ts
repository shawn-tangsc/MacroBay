import type { BriefingMarketRow } from './dailyBriefing/readings'

/**
 * 一行行情数据的**点位**与**涨跌幅**：唯一一处读取实现。
 *
 * 为什么必须只有一处：这两个数在文档里有两个来源——`close.value` 是点位，涨跌幅或落在
 * `change.value`、或落在 `value`（当 `value.format === 'percent'` 时，价格行就是这样，`change`
 * 按构造恒为 `null`）。渲染层各自去猜，就会出现「图上有、复制文本没有」这种同一份内容两个样子；
 * 今晚这个坑已经在价格卡、纳指、复制文本三处各犯过一次。
 *
 * 所以卡片与复制文本都调这里，格式化再各按各的出口（卡片加箭头与着色，文本加正负号）。
 */
export type BriefingRowFigures = Readonly<{
  /** 点位；这一行没有存点位时为 undefined（不是 0——0 是一个读数）。 */
  level?: number
  /** 涨跌幅（百分数，例如 1.23）；两个来源都没有时为 undefined。 */
  move?: number
}>

export function briefRowFigures(row: Readonly<{
  close?: Readonly<{ value: number }>
  change: Readonly<{ value: number }> | null
  value: Readonly<{ number: number; format: string }> | null
}>): BriefingRowFigures {
  const level = row.close?.value
  const move = row.change !== null
    ? row.change.value
    : row.value !== null && row.value.format === 'percent'
      ? row.value.number
      : undefined
  return Object.freeze({
    ...(level === undefined ? {} : { level }),
    ...(move === undefined ? {} : { move })
  })
}

/**
 * 涨跌幅的文本形态：一位小数、带正负号、不带箭头。
 *
 * 卡片会在它前面换成 `↑` / `↓`（箭头已经说了方向，数字就不带符号），复制出来的文本没有颜色与
 * 箭头可用，所以带符号。**数字本身必须逐字一致**——`1.2%` 不是 `1.23%`。
 */
export function formatRowMove(move: number | undefined, noValue: string): string {
  if (move === undefined) return noValue
  return `${move < 0 ? '' : '+'}${Math.abs(move).toFixed(1)}%`
}
