/**
 * 信号通知的句子骨架（契约 v2.56「源头拼成品」）。
 *
 * **只有这一份字符串**：源头拼成品读它，桌面文案表（旧记录「键 + 参数」的读取路径）也从它取值。
 * 两处各写一份的那天，同一件事会有新旧两种说法，而读者根本分不出哪条是新的。
 *
 * 骨架里的槽名是固定的，成品与旧记录都用同一批槽：
 * - 标题 `{asset} {headline}`：资产在前，读者可能同时在盯几个资产；
 * - 正文四个变体：规则 × 档位，模板里不写任何阈值（阈值由源头从规则常量填）；
 *   ETF 两个变体带 `{asOf}`——三日累计判的是**定稿的那一天**，不写明读者就分不清
 *   「半天数」和「定稿数」（2026-11-06 的原话：3.7 亿和 7.7 亿，不知道哪个算数）。
 */

export type SignalNotificationVariant =
  | 'etfOutflow'
  | 'etfOutflowAggravated'
  | 'oiDrop'
  | 'oiDropAggravated'

export type SignalNotificationLanguageSheet = Readonly<{
  /** 标题模板：`{asset}` + `{headline}`。 */
  title: string
  /** 标题里那一句「发生了什么」，按规则与档位选。 */
  headline: Readonly<Record<SignalNotificationVariant, string>>
  /** 正文模板：槽全部由源头填好；数字按语言格式化后才进来。 */
  body: Readonly<Record<SignalNotificationVariant, string>>
  /** 「为什么推了」：手机上会跟在正文后面一起发，所以它也必须是成品句子。 */
  reason: string
}>

export const signalNotificationSentences: Readonly<
  Record<'zh-CN' | 'en-US', SignalNotificationLanguageSheet>
> = Object.freeze({
  'zh-CN': Object.freeze({
    title: '{asset} {headline}',
    headline: Object.freeze({
      etfOutflow: 'ETF 连续净流出',
      etfOutflowAggravated: 'ETF 净流出加剧',
      oiDrop: '持仓骤降',
      oiDropAggravated: '持仓骤降加剧'
    }),
    body: Object.freeze({
      etfOutflow: '净流出 {amount}，超过 {threshold}的阈值（截至 {asOf} 收盘）',
      etfOutflowAggravated: '净流出 {amount}，是阈值的 {multiple}（截至 {asOf} 收盘）',
      oiDrop: '15 分钟跌 {dropPct}（阈值 {thresholdPct}），成交放大 {multiple}，规模约 {notional}',
      oiDropAggravated: '15 分钟跌 {dropPct}（强阈值 {strongPct}），成交放大 {multiple}，规模约 {notional}'
    }),
    reason: '规则命中，且读数达到这条规则的阈值。'
  }),
  'en-US': Object.freeze({
    title: '{asset} {headline}',
    headline: Object.freeze({
      etfOutflow: 'ETF outflows',
      etfOutflowAggravated: 'ETF outflows deepened',
      oiDrop: 'open interest dropped',
      oiDropAggravated: 'open interest fell further'
    }),
    body: Object.freeze({
      etfOutflow: '{amount} net outflow, past the {threshold} threshold (as of {asOf} close)',
      etfOutflowAggravated: '{amount} net outflow, {multiple} the threshold (as of {asOf} close)',
      oiDrop: 'Down {dropPct} in 15 min (threshold {thresholdPct}), volume {multiple}, about {notional}',
      oiDropAggravated: 'Down {dropPct} in 15 min (strong threshold {strongPct}), volume {multiple}, about {notional}'
    }),
    reason: 'A rule matched and the reading reached its threshold.'
  })
})
