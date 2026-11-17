import type { UnmappedSourceIdRow } from '../../../service/intelligence/macro-calendar/rendering/marketCalendarMappingRulesRead'
import type { CodeTableReadRow } from '../../../service/intelligence/macro-calendar/rendering/marketCalendarCodeTableRead'

/**
 * 导出的两件纯事：**文件名净化** 与 **行映射**。
 *
 * 文件名：筛选词是读者输入的自由文本，里面可能有 `/`、`:`、`?` 这类字符——直接拼进建议名，
 * 保存会失败或变成一个奇怪的路径片段。所以先删掉路径分隔符与控制字符，再拼日期。
 *
 * 行：导出的是**当前筛选结果的全量**，不是当前页——「导出」看起来像全量，就不能只给一页。
 */
const ILLEGAL = /[\\/:*?"<>|\u0000-\u001F]/gu

/** 建议文件名：`映射规则-2026-11-17.xlsx`；筛选词里的非法字符先清掉。 */
export function exportFileName(base: string, now: Date): string {
  const cleaned = base.replace(ILLEGAL, '').replace(/\s+/gu, ' ').trim().slice(0, 60)
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return `${cleaned === '' ? 'export' : cleaned}-${stamp}.xlsx`
}

/**
 * 码表工作表：一个码一行，与界面同一顺序。官网页三态与界面一致——**有页写地址本身**，
 * 待补写「待核」、不建写「—」，绝不写一个空链接（空链接会被读成「这个码没有官网页」）。
 */
export function codeTableExportRows(rows: readonly CodeTableReadRow[], text: Readonly<{
  columns: Readonly<Record<'code' | 'country' | 'name' | 'tierMeasure' | 'official' | 'status' | 'sourceIds', string>>
  unknownCountry: string
  status: Readonly<Record<'active' | 'not-built' | 'pending' | 'retired', string>>
  officialPending: string
  officialNone: string
}>): readonly (readonly (string | number)[])[] {
  const header = [text.columns.code, text.columns.country, text.columns.name, text.columns.tierMeasure,
    text.columns.official, text.columns.status, text.columns.sourceIds]
  return [header, ...rows.map((row) => [
    row.code,
    row.countryName ?? text.unknownCountry,
    `${row.names.zhFull} · ${row.names.enFull}`,
    [row.tier === null ? '' : String(row.tier), [row.measure, row.seasonality].filter((part) => part !== null).join(' · ')]
      .filter((part) => part !== '').join(' · '),
    // 与界面同一规则：不建、退役的码不写地址也不写「待核」——那是决定，不是待补。
    row.status === 'not-built' || row.status === 'retired'
      ? text.officialNone
      : 'pending' in row.officialSource ? text.officialPending : row.officialSource.url,
    text.status[row.status],
    row.sourceIdCount
  ])]
}

/** 样本名字：中英同格 `中文 · 英文`；英文没有就只写中文，**不留「中文 · 」半句**。 */
export function sampleText(row: Readonly<{ sampleLabel: string | null; sampleLabelEn: string | null }>): string {
  const zh = row.sampleLabel ?? ''
  const en = row.sampleLabelEn ?? ''
  if (zh !== '' && en !== '') return `${zh} · ${en}`
  return zh !== '' ? zh : en
}

/** 未映射段：源内 id · 行数 · 样本名字（中英同格，英文缺失时只写中文，不留半句）。 */
export function unmappedExportRows(rows: readonly UnmappedSourceIdRow[], text: Readonly<{
  columns: Readonly<Record<'sourceId' | 'rows' | 'sample', string>>
}>): readonly (readonly (string | number)[])[] {
  const header = [text.columns.sourceId, text.columns.rows, text.columns.sample]
  return [header, ...rows.map((row) => [row.sourceId, row.rowCount, sampleText(row)])]
}

