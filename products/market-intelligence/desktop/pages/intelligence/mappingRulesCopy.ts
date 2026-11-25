/**
 * 「映射规则」弹框的文案投影：把抽屉那份文案（`mkDay`）折成弹框要的形状。
 *
 * 单独成模块的理由：这是**文案表的投影**，不是渲染；原先它作为一个 30 多行的 `useMemo` 埋在抽屉里，
 * 抽屉读不动、改动也容易漏字段。而说明句（`mappingCodeCountryNote`）只能经 ⓘ 出现，取值放在 `.ts`
 * 里就不再被正文门禁当成「正文里的说明句」误判（它按行找 `*Note` 的用法点，只认 ⓘ 入口那一行）。
 */
import type { MappingRulesText } from './MappingRulesDialog'
import type { MacroIndicatorDrawerText } from './macroIndicatorDrawerText'

export function mappingRulesTextFrom(
  mk: MacroIndicatorDrawerText['mkDay'],
  /** 发布状态的白话名**只从日历那份文案来**：弹框里再写一份，同一状态就会有两个说法。 */
  eventStatus: Readonly<Record<string, string>>
): MappingRulesText {
  return {
    title: mk.mappingTitle, filter: mk.mappingFilter,
    tabCodes: mk.mappingTabCodes, tabUnmapped: mk.mappingTabUnmapped,
    onlyWithData: mk.mappingOnlyWithData,
    tabsAria: mk.mappingTabsAria, unavailable: mk.mappingUnavailable,
    codeColumns: mk.mappingCodeColumns, codeStatus: mk.mappingCodeStatus,
    // `countryAll` 不在这里：多选改造后弹框不再需要「全部」那一档，类型里已经删了，
    // 抽屉那份旧投影还留着一个没人读的字段（函数返回值不走多余属性检查，所以一直没红）。
    countryFilter: mk.mappingCountryFilter,
    countryNote: mk.mappingCodeCountryNote,
    officialOpen: mk.mappingOfficialOpen, officialPending: mk.mappingOfficialPending,
    officialPendingReasons: mk.mappingOfficialPendingReasons,
    officialNone: mk.mappingOfficialNone, codeEmpty: mk.mappingCodeEmpty,
    unmappedColumns: mk.mappingUnmappedColumns, unmappedEmpty: mk.mappingUnmappedEmpty,
    unmappedReasons: mk.mappingUnmappedReasons, reasonFilter: mk.mappingReasonFilter,
    reasonAll: mk.mappingReasonAll,
    tierStars: mk.mappingTierStars, tierAria: mk.mappingTierAria,
    tierFilterMulti: mk.mappingTierFilterMulti, countryFilterMulti: mk.mappingCountryFilterMulti,
    officialFilterMulti: mk.mappingOfficialFilterMulti,
    officialStates: {
      checked: mk.mappingOfficialChecked, pending: mk.mappingOfficialPending,
      none: mk.mappingOfficialNone
    },
    exportLabel: mk.mappingExport,
    tabEvents: mk.mappingTabEvents, eventColumns: mk.mappingEventColumns,
    eventsEmpty: mk.mappingEventsEmpty, sheetEvents: mk.mappingSheetEvents,
    eventTitleMissing: mk.mappingEventTitleMissing,
    tierNames: mk.mappingTierNames,
    exportNameZh: mk.mappingExportNameZh, exportNameEn: mk.mappingExportNameEn,
    statusUnknown: mk.mappingStatusUnknown,
    eventStatus,
    // 说明句由弹框自己按键取（它只出现在 ⓘ 里）；这里只交一个「键 → 文案」的查表函数。
    resolveCopy: (key) => (mk as unknown as Readonly<Record<string, string>>)[key] ?? key,
    sheetCodes: mk.mappingSheetCodes, sheetUnmapped: mk.mappingSheetUnmapped
  }
}
