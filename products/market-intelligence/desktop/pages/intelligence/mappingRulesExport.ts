import type { UnmappedSourceIdRow } from '../../../service/intelligence/macro-calendar/rendering/marketCalendarMappingRulesRead'
import type { CodeTableReadRow } from '../../../service/intelligence/macro-calendar/rendering/marketCalendarCodeTableRead'
import type { CalendarEventRow } from '../../../service/intelligence/macro-calendar/rendering/marketCalendarEventListRead'

/**
 * 导出的几件纯事：**文件名净化** 与 **行映射**。
 *
 * 文件名：筛选词是读者输入的自由文本，里面可能有 `/`、`:`、`?` 这类字符——直接拼进建议名，
 * 保存会失败或变成一个奇怪的路径片段。所以先删掉路径分隔符与控制字符，再拼日期。
 *
 * 行：导出的是**全量**，与筛选、页码无关——「导出」看起来像全量，就不能只给一页。
 *
 * **规矩：界面有的列，导出必须也有，而且用同一批文案与同一套格式化**（用户 2026-11-18）。
 * 以后给界面加列时，同步改这里的表头与取值；两处不一致，读者拿导出表去核对就会遇到第二套说法。
 * 导出可以比界面**更细**（名称拆成中文名 / 英文名两列，界面一格两行），但不能比界面少。
 */
const ILLEGAL = /[\\/:*?"<>|\u0000-\u001F]/gu

/** 建议文件名：`映射规则-2026-11-17.xlsx`；筛选词里的非法字符先清掉。 */
export function exportFileName(base: string, now: Date): string {
  const cleaned = base.replace(ILLEGAL, '').replace(/\s+/gu, ' ').trim().slice(0, 60)
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return `${cleaned === '' ? 'export' : cleaned}-${stamp}.xlsx`
}

type TierKey = '1' | '2' | '3' | 'other'

/**
 * 码表工作表：一个码一行，与界面同一顺序。
 *
 * 三处按界面口径写：
 * - **国家**：中文名，没有国家（事件类型码）写 `—`；
 * - **分级**：星级 + 中文档名（`★★★ 一级`），未分级是 `— 未分级`——星星单看没有含义；
 * - **官网页**：有页写「机构 · 地址」，待补写「待核」，不建/退役写 `—`。
 *   绝不写一个空链接（空链接会被读成「这个码没有官网页」）。
 */
export function codeTableExportRows(rows: readonly CodeTableReadRow[], text: Readonly<{
  columns: Readonly<Record<'code' | 'country' | 'tier' | 'measure' | 'official' | 'status'
    | 'sourceIds' | 'dataVolume', string>>
  nameZh: string
  nameEn: string
  tierStars: Readonly<Record<TierKey, string>>
  tierNames: Readonly<Record<TierKey, string>>
  unknownCountry: string
  status: Readonly<Record<'active' | 'not-built' | 'pending' | 'retired', string>>
  officialPending: string
  officialNone: string
}>): readonly (readonly (string | number)[])[] {
  const header = [text.columns.code, text.columns.country, text.nameZh, text.nameEn, text.columns.tier,
    text.columns.measure, text.columns.official, text.columns.status, text.columns.sourceIds,
    text.columns.dataVolume]
  return [header, ...rows.map((row) => {
    const tierKey: TierKey = row.tier === null ? 'other' : String(row.tier) as TierKey
    return [
      row.code,
      row.countryName ?? text.unknownCountry,
      row.names.zhFull,
      row.names.enFull,
      `${text.tierStars[tierKey]} ${text.tierNames[tierKey]}`.trim(),
      [row.measure, row.seasonality].filter((part) => part !== null).join(' · '),
      // 与界面同一规则：不建、退役的码不写地址也不写「待核」——那是决定，不是待补。
      row.status === 'not-built' || row.status === 'retired'
        ? text.officialNone
        : 'pending' in row.officialSource
          ? text.officialPending
          : `${row.officialSource.agency} · ${row.officialSource.url}`,
      text.status[row.status],
      row.sourceIdCount,
      row.releaseRowCount
    ]
  })]
}

/** 样本名字：中英同格 `中文 · 英文`；英文没有就只写中文，**不留「中文 · 」半句**。 */
export function sampleText(row: Readonly<{ sampleLabel: string | null; sampleLabelEn: string | null }>): string {
  const zh = row.sampleLabel ?? ''
  const en = row.sampleLabelEn ?? ''
  if (zh !== '' && en !== '') return `${zh} · ${en}`
  return zh !== '' ? zh : en
}

/**
 * 未映射工作表：源内 id · 原因（白话）· 首次出现（读者时区）· 来源 · 标题原文 · 行数。
 *
 * 顺序与界面一致（读口已按首次出现倒序排好，这里不再重排）；时间由调用方传进来的
 * `formatTime` 格式化——导出与界面必须显示同一个时刻，不在这里另拼一套。
 */
export function unmappedExportRows(rows: readonly UnmappedSourceIdRow[], text: Readonly<{
  columns: Readonly<Record<'sourceId' | 'reason' | 'firstSeen' | 'providers' | 'sample' | 'rows', string>>
  reasons: Readonly<Record<string, string>>
  reasonUnknown: string
  /** 没有首次出现时间时的说法：**不留空格**（空格会被读成「从来没有出现过」）。 */
  firstSeenUnknown: string
  formatTime: (instant: string) => string
}>): readonly (readonly (string | number)[])[] {
  const header = [text.columns.sourceId, text.columns.reason, text.columns.firstSeen,
    text.columns.providers, text.columns.sample, text.columns.rows]
  return [header, ...rows.map((row) => [
    row.sourceId,
    // `bad-period` 是只读遗留写法，与 `period-unresolved` 同档（读口同一口径），导出也要同一句话。
    text.reasons[String(row.reason) === 'bad-period' ? 'period-unresolved' : row.reason] ?? text.reasonUnknown,
    row.firstSeenAt === null ? text.firstSeenUnknown : text.formatTime(row.firstSeenAt),
    row.providerIds.join(' · '),
    sampleText(row),
    row.rowCount
  ])]
}

/**
 * 事件工作表：时间 · 国家 · 标题 · 来源 · 状态，与界面同列同序。
 *
 * 时间格由调用方给的 `timeOf` 决定（它同时用于界面与导出）：日期精度的事件在那一处
 * 按日历日显示，不在这里另算一遍，否则同一场事件在两处会显示成两个时间。
 */
export function eventExportRows(rows: readonly CalendarEventRow[], text: Readonly<{
  columns: Readonly<Record<'time' | 'country' | 'title' | 'provider' | 'status', string>>
  statusLabels: Readonly<Record<string, string>>
  statusUnknown: string
  titleMissing: string
}>, timeOf: (row: CalendarEventRow) => string): readonly (readonly string[])[] {
  const header = [text.columns.time, text.columns.country, text.columns.title,
    text.columns.provider, text.columns.status]
  return [header, ...rows.map((row) => [
    timeOf(row),
    row.countryName ?? '—',
    row.title === null ? text.titleMissing : sampleText({ sampleLabel: row.title, sampleLabelEn: row.titleEn }),
    row.sourceProviderId,
    // 状态取不到（没有标准行）→「无法确认」，不空着、不猜一个。
    row.status === null ? text.statusUnknown : (text.statusLabels[row.status] ?? text.statusUnknown)
  ])]
}