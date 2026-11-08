/**
 * What a conclusion may and may not say: the length limits, the wording that only makes sense to
 * the machinery that produced the brief, and the forecasts the product forbids.
 *
 * Kept apart from the validation flow so the rules can be read — and argued about — on their own.
 */

export const maximumSummaryLength = 600
export const maximumFieldLength = 300
export const maximumListItemLength = 240
export const maximumEvidenceRefs = 8
export const maximumConditions = 3
export const maximumCounterEvidence = 3
export const maximumWatchItems = 4
export const maximumListItems = 4
export const maximumRationaleLength = 200
/** A marker, not a paragraph: the reader sees it as a chip beside the direction tag. */
export const maximumRegimeMarkerLength = 48

/**
 * Wording that only makes sense to the system that produced the brief.
 *
 * The conclusion is read by a trader who never saw the packet: a window, a vote count, frozen data,
 * an earlier AI view or a process clock time explains the machinery, not the market. Each pattern
 * carries the concrete replacement the repair round must use.
 */
export const internalWordingPatterns: readonly Readonly<{ pattern: RegExp; repair: string }>[] = [
  { pattern: /窗口/, repair: 'name the day or session and the market move instead' },
  { pattern: /多数(?:判断|观点|结论|看法)|大部分(?:判断|观点|结论|看法)/, repair: 'state the market fact that carries the day, not a vote count' },
  { pattern: /冻结(?:数据|快照|事实|文档)/, repair: 'cite the actual release or flow and its number' },
  { pattern: /前提[^。；;!?]{0,6}削弱/, repair: 'say which price, flow or print changed and by how much' },
  { pattern: /(?<![A-Za-z])AI(?![A-Za-z])|人工智能/, repair: 'describe the market, not who produced an earlier view' },
  { pattern: /模型/, repair: 'describe the market, not the forecasting tool' },
  { pattern: /结论/, repair: 'state the call and its drivers directly' },
  { pattern: /时间线/, repair: 'drop the chronology; keep only the market event that matters' },
  { pattern: /\b(?:windows?)\b(?!\s+dressing)/i, repair: 'name the day or session and the market move instead' },
  { pattern: /\b(?:most|majority)\s+(?:of\s+)?(?:the\s+)?(?:calls?|views?|judg[ae]?ments?|conclusions?)\b/i, repair: 'state the market fact that carries the day, not a vote count' },
  { pattern: /\bfrozen\s+(?:data|snapshot|facts?|document)\b/i, repair: 'cite the actual release or flow and its number' },
  { pattern: /\bpremises?\b[^.]{0,30}\b(?:weakened|undermined)\b|\b(?:weakened|undermined)\s+premises?\b/i, repair: 'say which price, flow or print changed and by how much' },
  { pattern: /\bmodels?\b/i, repair: 'describe the market, not the forecasting tool' },
  { pattern: /\bconclusions?\b/i, repair: 'state the call and its drivers directly' },
  { pattern: /\btimelines?\b/i, repair: 'drop the chronology; keep only the market event that matters' }
]

/**
 * Labels that say nothing until they name the object that moved and the number it moved by. The
 * same sentence must carry a concrete market object or a number, otherwise the label is filler.
 */
export const vagueWordingTerms = [
  '分化', '承压', '风险偏好', '流动性',
  'divergence', 'under pressure', 'risk appetite', 'liquidity'
] as const

export const concreteAnchorPattern = /稳定币|美元|美债|国债|收益率|利率|资金费率|净流入|净流出|现货|期货|期权|比特币|以太坊|美联储|降息|加息|纳斯达克|标普|黄金|原油|美元指数|\b(?:etf|btc|eth|stablecoins?|dollars?|treasur(?:y|ies)|yields?|rates?|funds?|exchanges?|on-chain|open interest|funding|inflows?|outflows?|spot|futures|options|bitcoins?|ether|fed|nasdaq|s&p|gold|oil|dxy)\b/i

export const clockTimePattern = /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/
export const marketEventPattern = /CPI|PCE|GDP|PMI|FOMC|非农|议息|美联储|利率决议|公布|发布|数据|财报|开盘|收盘|盘前|盘后|拍卖|结算|交割|减半|升级|硬分叉|release|print|data|report|open|close|auction|settlement|decision|meeting|announcement|payrolls|inflation/i

/**
 * The mechanism chain: what changed → through what channel → BTC/ETH pressure or support. A
 * conclusion that only lists releases and moves has no link between them and is rejected.
 */
export const mechanismPattern = /因为|由于|导致|使得|进而|通过|传导|推动|压制|带动|引发|造成|驱动|\bbecause\b|\bleads?\s+to\b|\bled\s+to\b|\bleading\s+to\b|\bthrough\b|\bdriven\s+by\b|\bdrives?\b|\bpushes?\b|\bweighs?\s+on\b|\btransmits?\b/i

export const outlookStancePattern = /偏多|偏空|震荡|区间|看多|看空|中性|\b(?:bullish|bearish|range|choppy|sideways|neutral)\b/i
/**
 * "BTC against ETH", in the ways a person actually writes it.
 *
 * The first list is the taut form the prompt suggests. Real output says "相对 BTC 更弱" and "比 ETH
 * 更抗跌" — same fact, one word in between — and a pattern that only accepts the taut form rejects
 * the model for not reciting the whitelist word for word. The asset may sit inside the comparison,
 * so it is allowed to.
 */
const comparisonAsset = '(?:BTC|ETH|比特币|以太坊)'
export const relativeStrengthPattern = new RegExp(
  [
    '强于', '弱于', '跑赢', '跑输', '优于', '落后', '相对更强', '相对更弱', '更抗跌', '领涨', '领跌',
    `相对\\s*${comparisonAsset}\\s*[更偏]\\s*[强弱]`,
    `(?:相对于|相较于|比)\\s*${comparisonAsset}[^，。；]{0,12}?[更偏]\\s*[强弱]`,
    `[强弱]\\s*于\\s*${comparisonAsset}`,
    '\\b(?:outperform(?:s|ed|ing)?|underperform(?:s|ed|ing)?|stronger|weaker|relative\\s+strength)\\b',
    '\\b(?:stronger|weaker)\\s+than\\s+(?:BTC|ETH)\\b'
  ].join('|'),
  'i'
)
export const conditionalPattern = /若|如果|一旦|假如|假若|除非|\bif\b|\bwhen\b|\bunless\b/i

/**
 * Prohibited forecasts. Directional calls and conditions are the point; a price target, a trade
 * instruction or an invented probability is not. Precision is the tell: a fabricated `70%` claim
 * dresses an opinion as a measurement.
 */
export const forbiddenForecastPatterns: readonly Readonly<{ pattern: RegExp; repair: string }>[] = [
  { pattern: /目标价|目标位|目标价位|上看|下看|止盈|止损/, repair: 'drop the price target or trade instruction; state the direction, the mechanism and the condition that would flip it instead' },
  { pattern: /\b(?:price\s+target|target\s+price|stop[-\s]?loss|take[-\s]?profit)\b/i, repair: 'drop the price target or trade instruction; state the direction, the mechanism and the condition that would flip it instead' },
  { pattern: /建议\s*(?:买入|卖出|加仓|减仓|做多|做空)|(?:买入|卖出|加仓|减仓)\s*建议/, repair: 'drop the recommendation; write the directional bias and the condition that would invalidate it' },
  { pattern: /\b(?:buy|sell|long|short)\s+(?:btc|eth|bitcoin|ether|ethereum|the\s+dip)\b/i, repair: 'drop the recommendation; write the directional bias and the condition that would invalidate it' },
  { pattern: /(?:概率|可能性)\s*(?:为|约|大约|有)?\s*\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*%\s*(?:的)?(?:概率|可能性)|\b\d+(?:\.\d+)?\s*%\s*(?:probability|chance|odds|likely)\b/i, repair: 'drop the invented probability; use a conditional ("若/if … 则/then …") instead' }
]
