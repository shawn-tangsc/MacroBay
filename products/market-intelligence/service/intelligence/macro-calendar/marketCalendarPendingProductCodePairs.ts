/**
 * **同一指标、同季调、两个码**（架构师 2026-11-25 复核口径：真重复；`second-identity`）。
 *
 * 这里只收**季调相同的真重复**。季调不同的（`NONE` vs `SA`/`NSA`）是**两条数**——各落各的码，
 * 一条也不进这张名单；把它们当「待合并」，将来真合并会让两个口径的数串到一个码上。
 *
 * 每一对：`picked` 是本版落进映射表的那个；`deferred` 是同一件事的另一个码，**不删不并**。
 * `deferredInUse` 是「别的源内 id 是否也在用它」：为 0 的才允许标 `not-built` + `second-identity`
 * （见 `marketCalendarCodeTable.ts` 的 `codeTableReasonSets['not-built']`）；不为 0 的说明它自己在
 * 承载数据，标「不建」会与事实冲突，留 `active` 等产品定「哪张是规范表」。
 */
export type PendingProductCodePair = Readonly<{
  sourceId: string
  picked: string
  deferred: string
  /** 这个被挂起的码还有几个别的源内 id 在用（0 = 可以标 `not-built`）。 */
  deferredInUse: number
}>

export const pendingProductCodePairs: readonly PendingProductCodePair[] = Object.freeze([
  { sourceId: '10108', picked: 'US.WHOLESALE_INVENTORY.NONE.MOM', deferred: 'US.WHOLESALE_INVENTORIES.NONE.MOM', deferredInUse: 0 },
  { sourceId: '10153', picked: 'FR.CDAF_MANUFACTURING_PMI.NONE.LEVEL', deferred: 'FR.MARKIT_CDAF_MANUFACTURING_PURCHASING_MANAGERS.NONE.LEVEL', deferredInUse: 0 },
  { sourceId: '10155', picked: 'FR.CDAF_MANUFACTURING_PMI.NONE.LEVEL', deferred: 'FR.MARKIT_CDAF_MANUFACTURING_PURCHASING_MANAGERS.NONE.LEVEL', deferredInUse: 0 },
  { sourceId: '10156', picked: 'FR.CDAF_SERVICES_PMI.NONE.LEVEL', deferred: 'FR.MARKIT_CDAF_SERVICES_PURCHASING_MANAGERS.NONE.LEVEL', deferredInUse: 0 },
  { sourceId: '10158', picked: 'FR.CDAF_SERVICES_PMI.NONE.LEVEL', deferred: 'FR.MARKIT_CDAF_SERVICES_PURCHASING_MANAGERS.NONE.LEVEL', deferredInUse: 0 },
  { sourceId: '10195', picked: 'JP.SP_MANUFACTURING_PMI.NONE.LEVEL', deferred: 'JP.MANUFACTURING_PURCHASING_MANAGERS.NONE.LEVEL', deferredInUse: 0 },
  { sourceId: '10197', picked: 'JP.SP_MANUFACTURING_PMI.NONE.LEVEL', deferred: 'JP.MANUFACTURING_PURCHASING_MANAGERS.NONE.LEVEL', deferredInUse: 0 },
  { sourceId: '10213', picked: 'EMU.SP_COMPOSITE_PMI.NONE.LEVEL', deferred: 'EMU.MARKIT_COMPOSITE_PURCHASING_MANAGERS.NONE.LEVEL', deferredInUse: 0 },
  { sourceId: '10215', picked: 'EMU.SP_COMPOSITE_PMI.NONE.LEVEL', deferred: 'EMU.MARKIT_COMPOSITE_PURCHASING_MANAGERS.NONE.LEVEL', deferredInUse: 0 },
  { sourceId: '10266', picked: 'US.MICHIGAN_INFLATION_1Y.NONE.LEVEL', deferred: 'US.UNIVERSITY_MICHIGAN_1_YEAR_INFLATION_EXPECTATIONS.NONE.LEVEL', deferredInUse: 0 },
  { sourceId: '10269', picked: 'US.MICHIGAN_INFLATION_5Y.NONE.LEVEL', deferred: 'US.UNIVERSITY_MICHIGAN_5_10_YEAR_INFLATION_EXPECTATIONS.NONE.LEVEL', deferredInUse: 0 },
  { sourceId: '10270', picked: 'FR.CDAF_COMPOSITE_PMI.NONE.LEVEL', deferred: 'FR.MARKIT_CDAF_COMPOSITE_PURCHASING_MANAGERS.NONE.LEVEL', deferredInUse: 0 },
  { sourceId: '10272', picked: 'FR.CDAF_COMPOSITE_PMI.NONE.LEVEL', deferred: 'FR.MARKIT_CDAF_COMPOSITE_PURCHASING_MANAGERS.NONE.LEVEL', deferredInUse: 0 },
  { sourceId: '9378', picked: 'DE.ZEW_ECONOMIC_STATUS.NONE.LEVEL', deferred: 'DE.ZEW_CURRENT_CONDITIONS.NONE.LEVEL', deferredInUse: 0 },
  { sourceId: '9764', picked: 'CN.PROFITS_INDUSTRIAL_ENTERPRISES_DESIGNATED_SIZE.NONE.LEVEL', deferred: 'CN.PROFIT_INDUSTRIAL_ENTERPRISES_DESIGNATED_SIZE.NONE.AMOUNT', deferredInUse: 1 },
  { sourceId: '9946', picked: 'JP.LEADING_METRIC.NONE.MOM', deferred: 'JP.LEADING_METRIC.NONE.LEVEL', deferredInUse: 0 },
  { sourceId: '9947', picked: 'JP.LEADING_METRIC.NONE.MOM', deferred: 'JP.LEADING_METRIC.NONE.LEVEL', deferredInUse: 0 },
  { sourceId: '9948', picked: 'JP.LEADING_METRIC.NONE.MOM', deferred: 'JP.LEADING_METRIC.NONE.LEVEL', deferredInUse: 0 },
  { sourceId: '9952', picked: 'JP.COINCIDENT_INDEX.NONE.MOM', deferred: 'JP.COINCIDENT_INDEX.NONE.LEVEL', deferredInUse: 4 },
  { sourceId: '9953', picked: 'JP.COINCIDENT_INDEX.NONE.MOM', deferred: 'JP.COINCIDENT_INDEX.NONE.LEVEL', deferredInUse: 4 },
  { sourceId: '9954', picked: 'JP.COINCIDENT_INDEX.NONE.MOM', deferred: 'JP.COINCIDENT_INDEX.NONE.LEVEL', deferredInUse: 4 },
  { sourceId: '9955', picked: 'JP.COINCIDENT_INDEX.NONE.MOM', deferred: 'JP.SYNCHRONOUS_METRIC.NONE.MOM', deferredInUse: 4 },
  { sourceId: '9956', picked: 'JP.COINCIDENT_INDEX.NONE.MOM', deferred: 'JP.SYNCHRONOUS_METRIC.NONE.MOM', deferredInUse: 4 },
  { sourceId: '9957', picked: 'JP.COINCIDENT_INDEX.NONE.MOM', deferred: 'JP.SYNCHRONOUS_METRIC.NONE.MOM', deferredInUse: 4 },
  { sourceId: '9964', picked: 'GB.CIPS_MANUFACTURING_PMI.NONE.LEVEL', deferred: 'GB.MARKIT_CIPS_MANUFACTURING_PURCHASING_MANAGERS.NONE.LEVEL', deferredInUse: 0 },
  { sourceId: '9966', picked: 'GB.CIPS_MANUFACTURING_PMI.NONE.LEVEL', deferred: 'GB.MARKIT_CIPS_MANUFACTURING_PURCHASING_MANAGERS.NONE.LEVEL', deferredInUse: 0 },
  { sourceId: '9988', picked: 'EMU.SP_MANUFACTURING_PMI.NONE.LEVEL', deferred: 'EMU.MARKIT_MANUFACTURING_PURCHASING_MANAGERS.NONE.LEVEL', deferredInUse: 0 },
  { sourceId: '9990', picked: 'EMU.SP_MANUFACTURING_PMI.NONE.LEVEL', deferred: 'EMU.MARKIT_MANUFACTURING_PURCHASING_MANAGERS.NONE.LEVEL', deferredInUse: 0 },
  { sourceId: '9991', picked: 'EMU.SP_SERVICES_PMI.NONE.LEVEL', deferred: 'EMU.MARKIT_SERVICES_PURCHASING_MANAGERS.NONE.LEVEL', deferredInUse: 0 },
  { sourceId: '9993', picked: 'EMU.SP_SERVICES_PMI.NONE.LEVEL', deferred: 'EMU.MARKIT_SERVICES_PURCHASING_MANAGERS.NONE.LEVEL', deferredInUse: 0 },
])
