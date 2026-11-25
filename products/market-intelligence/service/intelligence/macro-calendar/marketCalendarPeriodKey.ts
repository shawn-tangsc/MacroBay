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

/**
 * **这是不是一个期次令牌**（PRD R38 §3.1 的五种形状，加现有的事件时刻写法）。
 *
 * 只判「像不像期次」，**不做归一、不猜**。用途只有一个：把**不是期次的段**挡在外面——
 * 官方 GDP 的事件键是 `US.GDP.2026-Q3.SECOND`，末段是二读序号，不是期次；它曾被当成期次写进
 * 标准表，与 BEA 的 `2026-Q3` 主键相差一期，同一次发布出现两行（0.4.5 #52）。
 *
 * 接受：`YYYY` / `YYYY-Qn` / `YYYY-MM` / `YYYY-MM-DD`，以及 `YYYY-MM-DDTHH:MM`
 * （事件路线的既有写法：期次用发布时刻到分钟，`marketCalendarStandardBackfill` 的 event 分支）。
 * 时刻形也算令牌是**故意的**：不算的话，本函数一上线就会把事件行当成「非期次」重解析，
 * 那是一次没人审批过的行为改变，不属这笔。
 */
export function isCalendarPeriodToken(value: string): boolean {
  return /^\d{4}$/.test(value) ||
    /^\d{4}-Q[1-4]$/.test(value) ||
    /^\d{4}-\d{2}$/.test(value) ||
    /^\d{4}-\d{2}-\d{2}$/.test(value) ||
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
}
