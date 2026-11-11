import { fillLabelParams } from '@platform/ui/components/textKeyParams'

import type { EconomicCalendarText } from './economicCalendarText'

/**
 * 官方日历「已停用」这一条，**从源注册表的同一个字段读起**。
 *
 * 为什么要有这个文件：页面上那两个地方（BLS 刷新按钮、行上那句说明）不许各写一份「403 / 已停止」，
 * 那就是同一件事的第二份实现——注册表改了原因码，文案还停在旧码上，没有人会发现。所以这里只做两件事：
 * 从 `SourceView.unavailable` 读出一份窄结构，再由**一个键**把句子拼出来。
 *
 * 停用与「读失败」是两件事：停用是拍板之后的现状（自动同步已经不在排期里），失败是一次尝试没成。
 * 因此这里不产生「同步失败」这类说法——那句话在停用之后没有对象。
 */
export type BlsUnavailable = Readonly<{
  reasonCode: string
  /** 注册表里最后一次真正写库的时刻；句子里的日期就取它，不另抄一份。 */
  lastSuccessDate?: string
}>

type SourceLike = Readonly<{
  sourceId: string
  unavailable?: Readonly<{ reasonCode: string; lastSuccessfulSyncAt?: string }>
}>

/** 一次年度同步的回执：三项各自的结果。页面与同步 hook 共用这一份形状。 */
export type BlsScheduleFeedback = Readonly<{
  year: string
  schedule: 'updated' | 'unchanged'
  cpi: 'updated' | 'current' | 'not-required' | 'unavailable'
  employment: 'updated' | 'current' | 'not-required' | 'unavailable'
}>

/** 注册表里 BLS 官方日程那一条的 sourceId。 */
export const BLS_SOURCE_ID = 'macro-calendar-bls'

export function readBlsUnavailable(sources: readonly SourceLike[] | undefined): BlsUnavailable | undefined {
  const source = sources?.find(entry => entry.sourceId === BLS_SOURCE_ID)
  const unavailable = source?.unavailable
  if (unavailable === undefined) return undefined
  const date = unavailable.lastSuccessfulSyncAt?.slice(0, 10)
  return { reasonCode: unavailable.reasonCode, ...(date === undefined ? {} : { lastSuccessDate: date }) }
}

/**
 * 停用说明那一句。**只认一个原因码**：别的码说明是另一种停用原因，那时应当由产品再给一句，
 * 而不是拿这一句套上去（403 与别的原因不是同一件事）。
 */
export function blsUnavailableSentence(text: EconomicCalendarText, unavailable: BlsUnavailable | undefined): string | undefined {
  if (unavailable === undefined || unavailable.reasonCode !== 'official-endpoint-returned-403') return undefined
  return fillLabelParams(text.blsUnavailableNotice, { date: unavailable.lastSuccessDate ?? '' })
}

/**
 * 列表顶部那一句「官方日程拿不到」（2026-11-11 更正）。
 *
 * 两句要分清：这一句说的是**整条腿**现在是什么样（BLS 的 HTML 日程被 403 挡住，自动同步停了，
 * 所以列表里那些 BLS 事件来自**上一次成功同步**）；`blsUnavailableNotice` 说的是详情里那行刷新键。
 *
 * 为什么点名 BLS 并带上日期：原来的句子是「官方源暂时不可用，先显示上次成功同步的内容」——
 * 读者会以为**全部**官方源都没了（fed/bea 其实照常在画），而且「上次」是哪一次没有人知道。
 * 这句只在 `macro-calendar-bls` 记着 403 时出现，fed/bea 正常与否都不影响它。
 *
 * 日期取注册表里那次真实同步的时刻（`lastSuccessfulSyncAt`），**不写死**。
 */
export function blsUnavailableListNote(text: EconomicCalendarText, unavailable: BlsUnavailable | undefined): string | undefined {
  if (unavailable === undefined || unavailable.reasonCode !== 'official-endpoint-returned-403') return undefined
  return fillLabelParams(text.officialUnavailableNote, { date: unavailable.lastSuccessDate ?? '' })
}

/**
 * 置灰那颗刷新键自己的行内句（界面设计 2026-11-09）。
 *
 * 「不能刷新」与「自动同步停了」不是同一句话：前者是键按不动的原因，后者是后台的现状。
 * 只置灰不说原因，读者只会以为界面坏了；所以这句话必须贴着那颗键说，并且说出**恢复条件**
 * （今天：要等官方站点不再拒绝当前网络，恢复时间未知）。
 *
 * **正文只给读者说法**：完整原因码不拼进这句话（2026-11-10 界面设计），它由
 * `blsRefreshBlockedReasonCode` 交给那颗 ⓘ，默认收起、恰一处。
 */
export function blsRefreshBlockedSentence(text: EconomicCalendarText, unavailable: BlsUnavailable | undefined): string | undefined {
  if (unavailable === undefined || unavailable.reasonCode !== 'official-endpoint-returned-403') return undefined
  return text.blsRefresh.blocked
}

/** 那枚 ⓘ 里要显示的完整原因码；与行内句同一个闸门，不会出现「句子在、码不在」。 */
export function blsRefreshBlockedReasonCode(unavailable: BlsUnavailable | undefined): string | undefined {
  if (unavailable === undefined || unavailable.reasonCode !== 'official-endpoint-returned-403') return undefined
  return unavailable.reasonCode
}
