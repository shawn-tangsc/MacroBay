import { slotForTriggerKey, type AnalysisSessionSlot } from './analysisSchedulePolicy'

/**
 * What is typical of one session, so the model can test it against this session's evidence.
 *
 * The reader's point when asking for fixed opens was that "变化幅度、交易方式是有区别的" — the thin,
 * range-bound Asian session and the event-driven US session are not the same market. These are the
 * priors that difference amounts to, in one owner so the prompt and any future UI cannot drift into
 * saying different things about the same session.
 *
 * They are priors, never conclusions: the prompt requires the model to judge this session's actual
 * conditions from the frozen evidence first, then say whether they match, and to let the evidence
 * win when they do not.
 */

export type AnalysisSessionBrief = Readonly<{
  slot: AnalysisSessionSlot
  /** Local wall-clock open, as the reader names it. */
  localTime: string
  label: string
  liquidity: string
  typicalVolatility: string
  dominantDrivers: readonly string[]
  typicalTradingStyle: string
  /** What this session is worth checking, phrased as questions the evidence can answer. */
  checkpoints: readonly string[]
}>

export const analysisSessionContext: Readonly<Record<AnalysisSessionSlot, AnalysisSessionBrief>> = Object.freeze({
  asia: Object.freeze({
    slot: 'asia' as AnalysisSessionSlot,
    localTime: '08:00',
    label: '亚洲盘',
    liquidity: '较薄',
    typicalVolatility: '通常偏低，多为区间震荡',
    dominantDrivers: Object.freeze(['亚洲宏观数据与央行动向', '区域新闻与监管消息', '隔夜美股与美债的余波']),
    typicalTradingStyle: '区间高抛低吸为主；突破常为假突破，追单需谨慎，仓位与止损都应按较薄流动性收紧',
    checkpoints: Object.freeze([
      '区间上下沿是否被有效突破（收盘价突破，而不是插针）',
      '成交量是否放大到足以支撑一段趋势',
      'BTC 与 ETH 是否同向：背离更像区间特征而不是趋势起点'
    ])
  }),
  europe: Object.freeze({
    slot: 'europe' as AnalysisSessionSlot,
    localTime: '16:00',
    label: '欧洲盘',
    liquidity: '回升',
    typicalVolatility: '中等，趋势更容易展开',
    dominantDrivers: Object.freeze(['欧洲宏观数据与央行表态', '欧洲股市开盘与风险偏好切换', '美元指数与实际利率方向']),
    typicalTradingStyle: '突破跟随为主；趋势初段入场的风险回报通常好于在区间中部反复交易',
    checkpoints: Object.freeze([
      '亚洲盘的区间是否被欧洲盘放量突破',
      '美元与实际利率的方向是否与加密价格同向',
      '资金费率是否随价格同向变化（背离说明是空头回补而非新多）'
    ])
  }),
  us: Object.freeze({
    slot: 'us' as AnalysisSessionSlot,
    localTime: '24:00',
    label: '美洲盘',
    liquidity: '最厚',
    typicalVolatility: '最高，事件驱动、尾部跳变多',
    dominantDrivers: Object.freeze(['美国宏观数据与美联储沟通', '美股开盘与风险资产联动', 'ETF 资金流与期货持仓变化']),
    typicalTradingStyle: '事件驱动与顺势为主；需要更大的止损空间，避免在数据公布瞬间追价',
    checkpoints: Object.freeze([
      '数据公布后的实际方向与幅度是否与预期差一致',
      '美股与加密是否同向：背离通常说明主导因素是加密内部资金流',
      'ETF 净流入/流出与价格是否配合'
    ])
  })
})

/** The brief for the session a run belongs to, or null for a run the schedule did not produce. */
export function sessionBriefForTriggerKey(triggerKey: string | null | undefined): AnalysisSessionBrief | null {
  const slot = slotForTriggerKey(triggerKey ?? '')
  return slot ? analysisSessionContext[slot] : null
}

/** The prompt's own session rules; only ever added when a run belongs to an open. */
export const analysisSessionPromptRules =
  '本次分析固定发生在盘口开盘时点，用户消息的 session 段给出该盘口的常态（流动性、典型波动、主导变量、典型交易方式）与开盘时刻。必须按这个顺序处理：'
  + '① 先用本次冻结证据判断该盘口此刻的实际情况（波动幅度相对近期水平、区间还是趋势、BTC 与 ETH 方向是否一致、资金与费率是否配合）；'
  + '② 再说明实际情况与盘口常态是否一致；'
  + '③ 不一致时以证据为准，并解释为什么这次不同；'
  + '④ session 段只是待检验的先验：禁止把盘口常态直接当成本次结论、禁止原样复述常态，也不得用固定阈值代替本次证据。'
  + '若本次是延迟补跑（开盘时刻早于快照时点），必须说明这是对开盘后的补跑，并区分"开盘时的状态"与"补跑时的状态"。'
