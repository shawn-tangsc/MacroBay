import type {
  DirectMetricRow, MappingRuleRow, UnmappedSourceIdRow
} from '../../../service/intelligence/macro-calendar/rendering/marketCalendarMappingRulesRead'
import { tierKeyOf } from './mappingRulesView'

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
 * 已映射工作表：八列，与界面同一顺序。`tier` 为 `null` 写「未分级」，`rowCount` 为 0 写 0。
 *
 * 一个工作表**至少有一行表头**：空表也是「只有表头」，不是「没有这张表」。
 */
export function mappedExportRows(rows: readonly MappingRuleRow[], text: Readonly<{
  columns: Readonly<Record<'sourceId' | 'metricKey' | 'name' | 'tier' | 'periodRule' | 'basis' | 'official' | 'rows', string>>
  tiers: Readonly<Record<'1' | '2' | '3' | 'other', string>>
}>): readonly (readonly (string | number)[])[] {
  const header = [text.columns.sourceId, text.columns.metricKey, text.columns.name, text.columns.tier,
    text.columns.periodRule, text.columns.basis, text.columns.official, text.columns.rows]
  return [header, ...rows.map((row) => [
    row.sourceId,
    row.metricKey,
    row.names === null ? '' : `${row.names.zh} · ${row.names.en}`,
    text.tiers[tierKeyOf(row.tier)],
    row.periodRule,
    row.basis ?? '',
    row.officialUrl ?? '',
    row.rowCount
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

/** 无需映射段：指标码 · 名称（中·英）· 分级 · 库里行数——没有「源内 id」，它本来就不经过映射。 */
export function directExportRows(rows: readonly DirectMetricRow[], text: Readonly<{
  columns: Readonly<Record<'metricKey' | 'name' | 'tier' | 'rows', string>>
  tiers: Readonly<Record<'1' | '2' | '3' | 'other', string>>
}>): readonly (readonly (string | number)[])[] {
  const header = [text.columns.metricKey, text.columns.name, text.columns.tier, text.columns.rows]
  return [header, ...rows.map((row) => [
    row.metricKey,
    row.names === null ? '' : `${row.names.zh} · ${row.names.en}`,
    text.tiers[tierKeyOf(row.tier)],
    row.rowCount
  ])]
}
