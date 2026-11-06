/**
 * 利率概率那个环的颜色：**只有这一处**。
 *
 * 页面靠 CSS 类上色（`dailyBriefingShareCard.css` 里的 `.mi-brief-poster__gauge-*`），导出件不能
 * 依赖样式表，得把描边写进 SVG 属性。两套各自判一次，就会两边不一致——2026-11-06 读者看到的
 * "导出图的环是蓝的、页面是橙的"就是这么来的：CSS 类按 `lead` 判（event 弧跟会议的加息/降息走），
 * 内联描边按 `outcome` 判，`event` 落到灰色那一档。
 *
 * 所以：**判定只做一次**（`policyGaugeTone`），颜色只查一次（`policyGaugePaints`），页面与导出各取
 * 同一个结果的一份字段。改配色只改这张表，以及 CSS 里那四行——`briefingDataAreaStyles.test.ts`
 * 逐条比对两边，改漏一处就红。
 */

export type PolicyGaugeTone = 'hike' | 'cut' | 'hold' | 'other'

/** 一种色调 = 一个 CSS 类 + 一个内联色值。两样在同一个条目里，分不开。 */
export const policyGaugePaints: Readonly<Record<PolicyGaugeTone, Readonly<{ className: string; stroke: string }>>> = Object.freeze({
  hike: Object.freeze({ className: 'mi-brief-poster__gauge-hike', stroke: '#c2410c' }),
  cut: Object.freeze({ className: 'mi-brief-poster__gauge-cut', stroke: '#1f5b32' }),
  hold: Object.freeze({ className: 'mi-brief-poster__gauge-hold', stroke: '#3f6d8f' }),
  other: Object.freeze({ className: 'mi-brief-poster__gauge-other', stroke: '#8c8474' })
})

/** 环的底槽：与样式表同一个色值与透明度，导出件自带一份。 */
export const policyGaugeTrackPaint: Readonly<{ stroke: string; opacity: number }> = Object.freeze({ stroke: '#a89f8d', opacity: 0.35 })

/**
 * 这一段弧是什么色调。判据按 `lead`（会议的定价方向）而不是段名：被定价成降息的会议拿降息绿，
 * 被定价成不动的拿维持蓝；`other` / `residual` 同灰（都表示"以上都不是"）。
 */
export function policyGaugeTone(outcome: string, lead: string): PolicyGaugeTone {
  if (outcome === 'event') {
    if (lead.startsWith('hike')) return 'hike'
    if (lead.startsWith('cut')) return 'cut'
    return 'hold'
  }
  return outcome === 'hold' ? 'hold' : 'other'
}

/** 一段弧的类名与描边。页面只用 `className`，导出只用 `stroke`，但两者同源。 */
export function policyGaugePaint(outcome: string, lead: string): Readonly<{ className: string; stroke: string }> {
  return policyGaugePaints[policyGaugeTone(outcome, lead)]
}
