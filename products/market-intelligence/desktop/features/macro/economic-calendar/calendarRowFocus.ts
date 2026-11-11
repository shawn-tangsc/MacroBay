/**
 * 关闭详情时焦点回到**被点的那一行**。
 *
 * `inline` 抽屉不抢焦点，但读者 Tab 进抽屉后按 Esc，焦点会落到 `body`，所以关闭时由宿主把焦点
 * 显式还回去。锚点用本页自己的行标记给——抽屉不猜（看板那边的行是另一种元素）。
 *
 * 月格与当日列表里可能有同名两行：读者点开的是当日列表里那一条，所以它优先；只有列表里没有
 * （例如行被重排掉）才退回月格那一格，都没有就什么都不做。
 */
export function calendarRowFor(eventKey: string): HTMLElement | null {
  const matches = [...document.querySelectorAll<HTMLElement>('button[data-calendar-row]')]
    .filter(row => row.dataset.eventKey === eventKey || row.dataset.marketEvent === eventKey)
  return matches.find(row => row.closest('[data-calendar-day-list]') !== null) ?? matches[0] ?? null
}
