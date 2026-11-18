/**
 * 「资金面读数变了」这两条通知的句子（R42，用户 2026-11-18：「每次 etf 和稳定币有数据更新了，
 * 应用内要弹框」；产品口径见 `docs-private/iterations/r42-capital-flow-update-notice/01-prd.md`）。
 *
 * 为什么句子住在这里而不是平台文案表：改数那条**必须同时给出旧值与新值**，标题也要分「新的一天」
 * 与「改了」两种——那是源头才知道的事实，平台只按读者语言挑一份。文案表里留的是没有成品句时的
 * 回退句（`text/notifications.ts`），两处都要有键（文案门禁按声明逐键检查）。
 *
 * 方向词与金额只此一份：`netFlowDirection` 把符号翻成词，金额走平台的
 * `formatNotificationNumber`（与信号通知同一个舍入实现），这里不新造第二套格式。
 */
export type CapitalFlowSentenceLanguage = 'zh-CN' | 'en-US'

export type NetFlowDirection = 'inflow' | 'outflow' | 'flat'

/** 符号翻成词：金额本身只印绝对值，方向由词表达（与资金面表同一个读法）。 */
export function netFlowDirection(netUsd: number): NetFlowDirection {
  return netUsd > 0 ? 'inflow' : netUsd < 0 ? 'outflow' : 'flat'
}

export type CapitalFlowNotificationSentences = Readonly<{
  direction: Readonly<Record<NetFlowDirection, string>>
  etfTitle: string
  etfRevisedTitle: string
  etfArrivedBody: string
  etfRevisedBody: string
  etfReason: string
  stablecoinTitle: string
  stablecoinBody: string
  stablecoinReason: string
}>

export const capitalFlowNotificationSentences: Readonly<Record<CapitalFlowSentenceLanguage, CapitalFlowNotificationSentences>> = Object.freeze({
  'zh-CN': Object.freeze({
    direction: Object.freeze({ inflow: '净流入', outflow: '净流出', flat: '持平' }),
    etfTitle: 'ETF 资金流 · {asset}',
    etfRevisedTitle: 'ETF 资金流改了 · {asset}',
    etfArrivedBody: '{day} {direction} {amount}',
    etfRevisedBody: '{day} 从 {previousDirection} {previousAmount} 改为 {direction} {amount}',
    etfReason: 'ETF 资金流的读数变了：新的一天，或你已经看过的那一天被修订。',
    stablecoinTitle: '稳定币总供给更新',
    stablecoinBody: '总供给 {amount}，一日{direction} {change}',
    stablecoinReason: '稳定币总供给的读数变了；同一天只提醒一次。'
  }),
  'en-US': Object.freeze({
    direction: Object.freeze({ inflow: 'inflow', outflow: 'outflow', flat: 'flat' }),
    etfTitle: 'ETF flows · {asset}',
    etfRevisedTitle: 'ETF flows revised · {asset}',
    etfArrivedBody: '{day} {direction} {amount}',
    etfRevisedBody: '{day} changed from {previousDirection} {previousAmount} to {direction} {amount}',
    etfReason: 'The ETF flow reading changed: a new day, or a day you had already seen was revised.',
    stablecoinTitle: 'Stablecoin supply updated',
    stablecoinBody: 'Total supply {amount}, one-day {direction} {change}',
    stablecoinReason: 'The stablecoin total supply changed; at most one notice a day.'
  })
})
