/**
 * 同一个字段、两个来源各给了一个值时，读者该看到什么。
 *
 * 口径由**用户 2026-11-16 拍板**（与产品偏好相反，按用户）：**谁的数据新用谁**——
 * 观测时刻更晚的那一个是主源。两源都有值且不等就**并列**，主源在前，并标「两源不一致」；
 * 只有主源没给、备用源给了，才显示那一个并标「备用来源」。值相同就显示一个、不加标记。
 *
 * 三条不许走样的边界：
 *
 * 1. **用观测时刻，不用写入时刻。** `observedAt` 是数据本身多新（源的观测时刻），
 *    写入时刻只说明我们什么时候拿到它。今天那条错值就是「三天前写进来的预期值」——
 *    拿写入时刻判，它反而是「最新」的。
 * 2. **同刻只认源注册表声明顺序**（产品 `r38-calendar-multi-source/01-prd.md`）：先声明者为主，
 *    不引第二层。不许用「谁先返回」「谁后写入」「id 字典序碰巧在前」这类实现细节——注册表顺序
 *    写在配置里、评审看得见；字典序是碰巧，明天加一个 id 就可能颠倒。
 * 3. **不做阈值。** 两个值不同就并列标注，没有「差异小于 X% 算一致」这种说法；
 *    空串算「没给」（Narwhal 的 `estimateValue: ''` 就是这种），不能当成一个值去比。
 */

/** 一个来源在这个字段上给出的读数。`value` 为空串＝这一项它没给。 */
export type CalendarSourceValue = Readonly<{
  /** 来源身份（feed id 或 `narwhal` / `0xrouter` 这种）。只用于同刻时的固定次序。 */
  source: string
  value: string
  /** 数据本身的观测时刻（`observed_at`），不是我们写入的时刻。 */
  observedAt: string
}>

export type CalendarTwoSourceValue =
  /** 只有一个来源给了值：`fromBackup` 为真表示给值的是被动那一方，要标「备用来源」。 */
  | Readonly<{ kind: 'single'; value: string; source: string; fromBackup: boolean }>
  /** 两源都给了、且不相等：并列显示，`primary` 是观测更新的那一个。 */
  | Readonly<{ kind: 'disagree'; primary: CalendarSourceValue; backup: CalendarSourceValue }>

const given = (candidate: CalendarSourceValue): boolean => candidate.value.trim() !== ''

/**
 * 源注册表里声明的位置：越靠前越优先。
 *
 * 这是**同刻时唯一的次序**（产品口径）：观测时刻相同就按它，不再往下比。没登记在表里的来源
 * 排在已登记的之后（实际不会发生——两个候选都来自注册表），此时保持传入顺序（排序是稳定的）。
 */
function declarationRank(source: string, declarationOrder: readonly string[]): number {
  const index = declarationOrder.indexOf(source)
  return index < 0 ? declarationOrder.length : index
}

/** 观测时刻更晚者在前；同刻按注册表声明顺序。 */
function freshnessOrder(left: CalendarSourceValue, right: CalendarSourceValue, declarationOrder: readonly string[]): number {
  const byObserved = Date.parse(right.observedAt) - Date.parse(left.observedAt)
  if (Number.isFinite(byObserved) && byObserved !== 0) return byObserved
  return declarationRank(left.source, declarationOrder) - declarationRank(right.source, declarationOrder)
}

/**
 * 两个候选 → 这一格该显示什么。
 *
 * 调用方给的是**同一字段**的两个来源读数（会话/预期/前值/发布时间各调一次）。
 * 两边都没有值 → `undefined`：那时读者该看到的是「未提供」，不是这里编一个。
 */
export function calendarTwoSourceValue(
  candidates: readonly CalendarSourceValue[],
  /** 源注册表里声明的顺序（先声明者为主），由调用方从注册表读出来传进来。 */
  declarationOrder: readonly string[]
): CalendarTwoSourceValue | undefined {
  const ordered = [...candidates].sort((left, right) => freshnessOrder(left, right, declarationOrder))
  const withValue = ordered.filter(given)
  if (withValue.length === 0) return undefined
  const [primary, backup] = withValue
  // 只有一方给了：它是主源就没有标记，是被动那一方就标「备用来源」。
  if (backup === undefined) {
    return { kind: 'single', value: primary!.value, source: primary!.source, fromBackup: ordered[0] !== primary }
  }
  // 两方都给且相同 → 显示一个、不加标记（不是「两源不一致」）。
  if (primary!.value === backup.value) {
    return { kind: 'single', value: primary!.value, source: primary!.source, fromBackup: false }
  }
  return { kind: 'disagree', primary: primary!, backup }
}
