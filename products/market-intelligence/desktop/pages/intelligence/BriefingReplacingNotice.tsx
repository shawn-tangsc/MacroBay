/**
 * 「上一版 · 正在重新生成」这条说明（`02` v2.167）。
 *
 * 重跑期间正文照常可读（不抢屏），但读者必须知道**看的是上一版**——静默拿旧内容顶新的一期，
 * 会把上一次的数当成这次的结果。这条说明就是那个"说清楚"的位置，独立成一个组件有两个好处：
 * 它是**状态**（`role="status"`，读屏会念），而且可以单独测"显示 / 不显示"两态。
 *
 * 什么时候出现由调用方决定（模式为 `ready-replacing`），这里只吃一个布尔与已经解析好的文案，
 * 不自己判期号、不自己查语言。
 */
export function BriefingReplacingNotice({ visible, label }: Readonly<{ visible: boolean; label: string }>): React.ReactElement | null {
  if (!visible) return null
  return <p className="mi-daily-briefing-page__replacing-note" role="status" data-briefing-previous-version="true">{label}</p>
}
