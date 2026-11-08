/**
 * 「可命名的**被变读数**」（架构师 `04` §3.4.1）：说得出名字、可以被变化的那个数。
 *
 * 只放读数：稳定币、收益率、资金费率、净流入、BTC/ETH、指数、情绪……
 * **不放政策动作词**（降息/加息）也**不放机构名**（美联储）——它们不是"读数"，
 * 把它们混进来，`降息 +5%` 会被当成"绑到了读数"而放行，其实那是概率语境，必须拒。
 *
 * 为什么放在 `contracts/`：日报结论校验与分析概率校验都要用，而日报依赖分析、分析不依赖日报；
 * 词表只能放在两边都能依赖的中立层。**唯一实现**：`daily-briefing` 那对文件从这里 re-export，
 * 分析侧直接 import，全仓只有这一处定义。
 */
export const concreteReadingPattern =
  /稳定币|美元|美债|国债|收益率|利率|资金费率|净流入|净流出|现货|期货|期权|比特币|以太坊|纳斯达克|标普|黄金|原油|美元指数|情绪|指数|\b(?:etf|btc|eth|stablecoins?|dollars?|treasur(?:y|ies)|yields?|rates?|funds?|exchanges?|on-chain|open interest|funding|inflows?|outflows?|spot|futures|options|bitcoins?|ether|nasdaq|s&p|gold|oil|dxy|sentiment|index)\b/i

/**
 * 日报「空泛措辞」判定用的完整锚点表：**读数 + 机构 + 政策动作**。
 *
 * 它比读数表宽是有原因的：日报判的是"这句话有没有说具体的东西"，
 * 「美联储」「降息」当然算具体；而分析侧判的是"这个带符号的百分比绑在谁身上"，
 * 政策动作词在那里恰恰意味着概率语境。两个问题，两份用法，但**读数部分只有上面那一份**。
 */
export const concreteAnchorPattern = new RegExp(
  `${concreteReadingPattern.source}|美联储|降息|加息`,
  concreteReadingPattern.flags
)
