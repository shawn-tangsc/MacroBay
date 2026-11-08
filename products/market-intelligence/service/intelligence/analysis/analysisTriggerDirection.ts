/**
 * 信号唤起的那次分析：**信号的方向**（N12）。
 *
 * 只做一件事：把触发键 `signal.<moduleId>.<ruleId>` 里的规则名翻成"这条信号说的是价格往哪边走"。
 * 触发键是运行记录上唯一可靠的信号身份——运行行上不存方向，重读信号表又会拿到"最新的那条"，
 * 不一定是唤起这次运行的那一条。
 *
 * 为什么方向要在这里另列一张表：规则的 `direction` 是**清算侧**（多头被清 / 空头被清），
 * 而推送要判的是**价格方向**。两者不能混（多头被清 = 价格跌）。新规则没登记时返回 `undefined`，
 * 推送那边按"没有证据说反了"处理——只进中心，不叫醒手机。
 */
export type AnalysisTriggerDirection = 'bullish' | 'bearish' | undefined

/** 触发键 → 规则名；不是信号触发键就返回 `undefined`（手动、日历、时段都不走这条）。 */
export function signalRuleIdOf(triggerKey: string): string | undefined {
  const match = /^signal\.[a-z0-9]+(?:-[a-z0-9]+)*\.([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(triggerKey)
  return match?.[1]
}

/**
 * 价格方向。登记的都是"规则本身就规定了方向"的那几条：
 * - `oi-liquidation-proxy`：多头被清（价格跌）→ bearish；
 * - `oi-short-liquidation-proxy`：空头被清（价格涨）→ bullish；
 * - `etf-outflow-3d`：连续三日净流出 → bearish。
 *
 * `macro-surprise` 不在其列：宏观意外的方向取决于意外本身，不取决于规则名，凭规则名断言会造假。
 */
const priceDirectionByRuleId: Readonly<Record<string, 'bullish' | 'bearish'>> = Object.freeze({
  'oi-liquidation-proxy': 'bearish',
  'oi-short-liquidation-proxy': 'bullish',
  'etf-outflow-3d': 'bearish'
})

export function analysisTriggerDirectionOf(triggerKey: string): AnalysisTriggerDirection {
  const ruleId = signalRuleIdOf(triggerKey)
  return ruleId === undefined ? undefined : priceDirectionByRuleId[ruleId]
}
