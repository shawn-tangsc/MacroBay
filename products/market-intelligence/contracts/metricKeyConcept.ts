/**
 * 「指标码 → 概念」的唯一数据表（架构师规格 `29-指标映射单表规格.md`，Chief 2026-11-14 定死位置）。
 *
 * 为什么是**契约数据**而不是服务层逻辑：同一概念的季调/未季调变体，对读者是同一个指标
 * （影响程度一样、盘口是同一个市场、事件标注是同一条），所以「哪几个码是同一个概念」是身份事实，
 * 不是某条读取链的实现细节。放在契约层，catalog、盘口、政策路径都从这一份取，谁都不许再写一份。
 *
 * 三条规矩：
 * 1. **只放数据**：表 + 一个三行的取值函数，不 import 任何东西（服务层、渲染层都不许）；
 * 2. **加变体 = 加一行**：新增季调/未季调变体时只改这张表，catalog、盘口表、政策路径清单都不用动；
 * 3. **两侧对得上**：这里出现的每个码必须在「12 张卡片行」或「退役码表」里，反过来也一样——
 *    守卫 `metricKeyConcept.test.ts` 双向断言，漏一个就红（否则它会悄悄变成另一份没人对得上的清单）。
 *
 * 概念串沿用码的形状（`US.CPI.YOY`），只去掉口径段（`SA` / `NSA`）：它读起来就是那个指标本身。
 */
export const metricConceptByMetricKey: Readonly<Record<string, string>> = Object.freeze({
  // CPI 卡四行
  'US.CPI.NSA.YOY': 'US.CPI.YOY',
  'US.CPI.SA.MOM': 'US.CPI.MOM',
  'US.CORE_CPI.NSA.YOY': 'US.CORE_CPI.YOY',
  'US.CORE_CPI.SA.MOM': 'US.CORE_CPI.MOM',
  // 就业卡四行
  'US.NONFARM.SA.CHANGE': 'US.NONFARM.CHANGE',
  'US.UNEMPLOYMENT.SA.RATE': 'US.UNEMPLOYMENT.RATE',
  'US.AHE.SA.MOM': 'US.AHE.MOM',
  'US.AHE.NSA.YOY': 'US.AHE.YOY',
  // PCE 卡四行
  'US.PCE.SA.YOY': 'US.PCE.YOY',
  'US.PCE.SA.MOM': 'US.PCE.MOM',
  'US.CORE_PCE.SA.YOY': 'US.CORE_PCE.YOY',
  'US.CORE_PCE.SA.MOM': 'US.CORE_PCE.MOM',
  // 已退役的未季调变体：历史行还在，身份仍是同一个概念（所以盘口与标注按概念取时，它们照样命中）
  'US.PCE.NSA.YOY': 'US.PCE.YOY',
  'US.CORE_PCE.NSA.YOY': 'US.CORE_PCE.YOY'
})

/**
 * 表的访问器：未知码**自成概念**（`evt.fomc`、源内身份这类没有口径段的码原样返回）。
 *
 * 这一行不算业务逻辑：没有它，catalog、盘口、显示名三处会各写一遍同一个取值表达式——
 * 那正是这张表要消灭的东西。它不 import 任何模块，也不做判断以外的事。
 */
export function metricConceptOf(metricKey: string): string {
  return metricConceptByMetricKey[metricKey] ?? metricKey
}
