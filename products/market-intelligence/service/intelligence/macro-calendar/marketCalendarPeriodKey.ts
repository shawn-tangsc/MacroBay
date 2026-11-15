/**
 * **期次的唯一写法：`YYYY-MM`。**
 *
 * BLS 自己的参考期写法是 `YYYY-MNN`（`2026-M10`），那是**来源内部的键**（`blsObservedValuesParser`
 * 与三处 BLS 同步都按它定型）。标准表对外只保留一种写法，理由不是美观：
 *
 * - 同一期在表里会变成两行（主键是「身份 + 首发布日」，两种写法绕过去了），日历上同一次发布出现两次；
 * - FRED 只认 `2026-10`，补值对 `2026-M10` 那行**永远拿不到值**，只能停在「未提供」。
 *
 * 所以归一只有这一处实现：来源怎么写归来源，进标准表前一律换成 `YYYY-MM`。
 * 非「年-月」的期次（`2026-Q3`、`2026-11-10` 这类）原样返回——这个函数不认识它们，也不猜。
 */
const mPeriodPattern = /^(\d{4})-M(\d{2})$/

/** 这个期次是不是 BLS 的 `YYYY-MNN` 写法（用于迁移里找需要合并的行）。 */
export function isMPeriodKey(value: string): boolean {
  return mPeriodPattern.test(value)
}

/** 归一到 `YYYY-MM`；不是 `YYYY-MNN` 的原样返回（一种写法只许产出一个期次）。 */
export function normalizeCalendarPeriodKey(value: string): string {
  const match = mPeriodPattern.exec(value)
  return match === null ? value : `${match[1]}-${match[2]}`
}

/**
 * 来源事件 id 的期次段同样归一：`US.CPI.NSA.YOY.RELEASE.2026-M10` 与 `…2026-10` 是**同一个发布**，
 * id 若各留一份，台账与行的比对会永远差一条（而差的其实是同一件事）。
 */
export function normalizeCalendarSourceEventId(value: string): string {
  return value.replace(/\.(\d{4})-M(\d{2})$/, '.$1-$2')
}
