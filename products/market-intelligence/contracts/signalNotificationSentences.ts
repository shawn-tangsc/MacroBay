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
 *   措辞是「交易日」不是「收盘」：ETF 日流按美股交易日算，读者时区不一定是美国，
 *   写「收盘」会被读成本地收盘，反而多一层误解。
 */

export type SignalNotificationVariant =
  | 'etfOutflow'
  | 'etfOutflowAggravated'
  /** 旧记录用过的两个变体：只服务已落库的通知，新记录用下面按方向分的四个。 */
  | 'oiDrop'
  | 'oiDropAggravated'
  | 'oiLong'
  | 'oiLongAggravated'
  | 'oiShort'
  | 'oiShortAggravated'

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
      oiDropAggravated: '持仓骤降加剧',
      // 方向必须进标题：只说「持仓骤降」读者分不清谁被清，两个方向的动作是相反的。
      oiLong: '多头爆仓',
      oiLongAggravated: '多头爆仓加剧',
      oiShort: '空头爆仓',
      oiShortAggravated: '空头爆仓加剧'
    }),
    body: Object.freeze({
      etfOutflow: '净流出 {amount}，超过 {threshold}的阈值（截至 {asOf} 交易日）',
      etfOutflowAggravated: '净流出 {amount}，是阈值的 {multiple}（截至 {asOf} 交易日）',
      oiDrop: '15 分钟跌 {dropPct}（阈值 {thresholdPct}），成交放大 {multiple}，规模约 {notional}',
      oiDropAggravated: '15 分钟跌 {dropPct}（强阈值 {strongPct}），成交放大 {multiple}，规模约 {notional}',
      oiLong: '多头被强制平仓：15 分钟跌 {dropPct}（阈值 {thresholdPct}），成交放大 {multiple}，规模约 {notional}',
      oiLongAggravated: '多头被强制平仓：15 分钟跌 {dropPct}（强阈值 {strongPct}），成交放大 {multiple}，规模约 {notional}',
      oiShort: '空头被强制平仓：15 分钟涨 {pricePct}（阈值 {thresholdPct}），成交放大 {multiple}，规模约 {notional}',
      oiShortAggravated: '空头被强制平仓：15 分钟涨 {pricePct}（强阈值 {strongPct}），成交放大 {multiple}，规模约 {notional}'
    }),
    reason: '规则命中，且读数达到这条规则的阈值。'
  }),
  'en-US': Object.freeze({
    title: '{asset} {headline}',
    headline: Object.freeze({
      etfOutflow: 'ETF outflows',
      etfOutflowAggravated: 'ETF outflows deepened',
      oiDrop: 'open interest dropped',
      oiDropAggravated: 'open interest fell further',
      oiLong: 'long liquidations',
      oiLongAggravated: 'long liquidations deepened',
      oiShort: 'short liquidations',
      oiShortAggravated: 'short liquidations deepened'
    }),
    body: Object.freeze({
      etfOutflow: '{amount} net outflow, past the {threshold} threshold (as of the {asOf} trading day)',
      etfOutflowAggravated: '{amount} net outflow, {multiple} the threshold (as of the {asOf} trading day)',
      oiDrop: 'Down {dropPct} in 15 min (threshold {thresholdPct}), volume {multiple}, about {notional}',
      oiDropAggravated: 'Down {dropPct} in 15 min (strong threshold {strongPct}), volume {multiple}, about {notional}',
      oiLong: 'Longs forced out: down {dropPct} in 15 min (threshold {thresholdPct}), volume {multiple}, about {notional}',
      oiLongAggravated: 'Longs forced out: down {dropPct} in 15 min (strong threshold {strongPct}), volume {multiple}, about {notional}',
      oiShort: 'Shorts forced out: up {pricePct} in 15 min (threshold {thresholdPct}), volume {multiple}, about {notional}',
      oiShortAggravated: 'Shorts forced out: up {pricePct} in 15 min (strong threshold {strongPct}), volume {multiple}, about {notional}'
    }),
    reason: 'A rule matched and the reading reached its threshold.'
  })
})
