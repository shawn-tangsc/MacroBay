// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { macroIndicatorDrawerText } from './macroIndicatorDrawerText'
import { MappingRulesPanel } from './MappingRulesPanel'

/**
 * 界面语言必须传到读口（用户 2026-11-21：英文界面下国家列还是中文）。
 *
 * 读口已经按 `locale` 取（`3d43318`），但**调用点不传就永远走默认 `zh`**——这条钉住接线：
 * 英文 shell 下两个查询都要带 `locale: 'en'`。**红证**：把 `locale` 写死成 `'zh'` 立即红。
 */
const spies = vi.hoisted(() => ({
  codeTable: vi.fn(async (_input?: { locale?: string }) => ({ state: 'unavailable' as const, reasonCode: 'query-unavailable' as const })),
  mappingRules: vi.fn(async (_input?: { locale?: string }) => ({ state: 'unavailable' as const, reasonCode: 'query-unavailable' as const })),
  eventList: vi.fn(async () => ({ state: 'unavailable' as const, reasonCode: 'query-unavailable' as const }))
}))
vi.mock('../../shared/ipc/marketCalendarClient', () => ({
  marketCalendarClient: { queryCodeTable: spies.codeTable, queryMappingRules: spies.mappingRules,
    queryEventList: spies.eventList, queryValueRevisions: vi.fn() }
}))

const mkDay = macroIndicatorDrawerText['zh-CN'].mkDay
const text = {
  title: mkDay.mappingTitle, filter: mkDay.mappingFilter, tabCodes: mkDay.mappingTabCodes,
  tabUnmapped: mkDay.mappingTabUnmapped, tabsAria: mkDay.mappingTabsAria,
  unavailable: mkDay.mappingUnavailable, countryNote: mkDay.mappingCodeCountryNote,
  countryFilter: mkDay.mappingCountryFilter,
  codeColumns: mkDay.mappingCodeColumns, codeStatus: mkDay.mappingCodeStatus,
  onlyWithData: mkDay.mappingOnlyWithData, officialOpen: mkDay.mappingOfficialOpen,
  officialPending: mkDay.mappingOfficialPending, officialPendingReasons: mkDay.mappingOfficialPendingReasons,
  officialNone: mkDay.mappingOfficialNone,
  codeEmpty: mkDay.mappingCodeEmpty, unmappedColumns: mkDay.mappingUnmappedColumns,
  unmappedEmpty: mkDay.mappingUnmappedEmpty, unmappedReasons: mkDay.mappingUnmappedReasons,
  reasonFilter: mkDay.mappingReasonFilter, reasonAll: mkDay.mappingReasonAll,
  tierStars: mkDay.mappingTierStars, tierAria: mkDay.mappingTierAria,
  tierNames: mkDay.mappingTierNames,
  tierFilterMulti: mkDay.mappingTierFilterMulti, countryFilterMulti: mkDay.mappingCountryFilterMulti,
  officialFilterMulti: mkDay.mappingOfficialFilterMulti,
  officialStates: { checked: mkDay.mappingOfficialChecked, pending: mkDay.mappingOfficialPending, none: mkDay.mappingOfficialNone },
  exportLabel: mkDay.mappingExport, resolveCopy: () => '',
  sheetCodes: mkDay.mappingSheetCodes, sheetUnmapped: mkDay.mappingSheetUnmapped,
  tabEvents: mkDay.mappingTabEvents, eventColumns: mkDay.mappingEventColumns,
  eventsEmpty: mkDay.mappingEventsEmpty, eventTitleMissing: mkDay.mappingEventTitleMissing,
  sheetEvents: mkDay.mappingSheetEvents, exportNameZh: mkDay.mappingExportNameZh,
  exportNameEn: mkDay.mappingExportNameEn, statusUnknown: mkDay.mappingStatusUnknown,
  eventStatus: {}
}

let root: Root | undefined
let host: HTMLDivElement | undefined
beforeEach(() => {
  spies.codeTable.mockClear()
  spies.mappingRules.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
})

describe('the panel passes the interface language to both reads', () => {
  it('sends locale "en" under an English shell', async () => {
    await act(async () => {
      root!.render(<ShellLanguageProvider language="en-US"><ShellTimeZoneProvider timeZone="Asia/Shanghai">
        <MappingRulesPanel open onClose={() => undefined} text={text} />
      </ShellTimeZoneProvider></ShellLanguageProvider>)
    })
    await act(async () => { await Promise.resolve() })
    // 两个查询都必须带语言；带错档（或写死 zh）这条就红。
    expect(spies.codeTable.mock.calls[0]?.[0]).toEqual({ locale: 'en' })
    expect(spies.mappingRules.mock.calls[0]?.[0]).toEqual({ locale: 'en' })
  })

  it('sends locale "zh" under a Chinese shell', async () => {
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><ShellTimeZoneProvider timeZone="Asia/Shanghai">
        <MappingRulesPanel open onClose={() => undefined} text={text} />
      </ShellTimeZoneProvider></ShellLanguageProvider>)
    })
    await act(async () => { await Promise.resolve() })
    expect(spies.codeTable.mock.calls[0]?.[0]).toEqual({ locale: 'zh' })
  })
})
