/**
 * **族名词表**（产品经理定，用户 2026-11-18；来源 `36-族名词表.md`）。
 *
 * 生成器**只能从这里选族名**，选不出就进待定、不建码——不许现场发明（`UNSEASONALLY_*` 那批就是
 * 「按标题硬凑」的产物）。三段的含义：
 * - `adopt`：跨国通用主干，同一概念跨国同名（`CONSUMER_PRICE` / `GDP` / `UNEMPLOYMENT_RATE`…）；
 * - `countrySpecific`：**国别特有指标**（Ifo、ZEW、Ivey、NAB、RICS…），只在一国出现也照建；
 * - `mergeAliases`：源里的旧写法 → 规范族名（`TRADE_ACCOUNT → TRADE_BALANCE`、
 *   `CONSTRUCTION_PERMIT → BUILDING_PERMITS`、`DAY_TUNER_INDUSTRIAL_OUTPUT → INDUSTRIAL_OUTPUT`）；
 * - `reject`：真的没有信息量的残片（`Q`、`SK`、`ASIC`…），不进词表也不建码。
 *
 * **机翻标题不属 `reject`**：`DAY_TUNER_*`、`TRANSMUTATION_*`、`UNSEASONALLY_*` 要映射到规范族名
 * （`INDUSTRIAL_OUTPUT` / `GDP` / `UNEMPLOYMENT`），季调信息进 `seasonality` 列、测度进 `measure` 列。
 */
export const marketCalendarFamilyVocabulary = Object.freeze({
  adopt: Object.freeze([
    'CONSUMER_PRICE', 'CORE_CONSUMER_PRICE', 'HARMONIZED_CONSUMER_PRICE', 'PRODUCER_PRICE',
    'EXPORTS_PRICE', 'IMPORTS_PRICE', 'GDP', 'REAL_GDP', 'INDUSTRIAL_OUTPUT', 'MANUFACTURING_OUTPUT',
    'RETAIL_SALES', 'CORE_RETAIL_SALES', 'UNEMPLOYMENT', 'UNEMPLOYMENT_RATE',
    'EMPLOYMENT_PARTICIPATION_RATE', 'CHANGES_IN_EMPLOYED_POPULATION', 'CONSUMER_CONFIDENCE',
    'EXPORTS', 'IMPORTS', 'MERCHANDISE_EXPORTS', 'MERCHANDISE_IMPORTS', 'MERCHANDISE_TRADE_ACCOUNT',
    'TRADE_BALANCE', 'CURRENT_ACCOUNT', 'FOREIGN_EXCHANGE_RESERVES', 'MONEY_SUPPLY_M',
    'BUILDING_PERMITS', 'NEW_HOUSING_STARTS', 'WHOLESALE_INVENTORIES', 'ZEW_ECONOMIC_STATUS'
  ] as const),
  countrySpecific: Object.freeze([
    'IFO_BUSINESS_CLIMATE', 'IFO_CURRENT_CONDITIONS', 'IFO_EXPECTATIONS',
    'ZEW_ECONOMIC_SENTIMENT', 'ZEW_INVESTOR_CONFIDENCE', 'GFK_CONSUMER_CONFIDENCE',
    'INSEE_BUSINESS_CONFIDENCE', 'INSEE_MANUFACTURING_CONFIDENCE',
    'ISTAT_BUSINESS_CONFIDENCE', 'ISTAT_CONSUMER_CONFIDENCE',
    'IVEY_PMI', 'IVEY_PURCHASING_MANAGERS', 'NAB_BUSINESS_CLIMATE', 'NAB_BUSINESS_CONFIDENCE',
    'NAB_BUSINESS_CONFIDENCE', 'RICS_HOUSE_PRICE', 'KOF_LEADING_INDICATOR', 'KOF_LEADING_METRIC',
    'SVME_PMI', 'SVME_PURCHASING_MANAGERS', 'SENTIX_INVESTOR_CONFIDENCE',
    'HALIFAX_HOUSE_PRICE', 'NATIONWIDE_HOUSE_PRICE', 'RIGHTMOVE_AVERAGE_HOUSE_ASKING',
    'DCLG_HOUSE_PRICE', 'NIESR_THREE_MONTH_GDP', 'CAIXIN', 'ADACI', 'CIPS', 'NBS', 'RBC', 'CDAF',
    'TD_MI_INFLATION', 'SP_CS_HOUSE_PRICE', 'CAIXIN_PMI', 'ISM'
  ] as const),
  /** 源写法 → 规范族名。**只收同一概念的不同拼法**，不把两个不同指标并成一个。 */
  mergeAliases: Object.freeze({
    CONSTRUCTION_PERMIT: 'BUILDING_PERMITS',
    TRADE_ACCOUNT: 'TRADE_BALANCE',
    MERCHANDISE_TRADE_ACCOUNT: 'MERCHANDISE_TRADE_ACCOUNT',
    DAY_TUNER_INDUSTRIAL_OUTPUT: 'INDUSTRIAL_OUTPUT',
    DAY_TUNER_GDP: 'GDP',
    WHOLESALE_INVENTORY: 'WHOLESALE_INVENTORIES',
    LABOR_COSTS: 'UNIT_LABOR_COSTS',
    UNSEASONALLY_CURRENT_ACCOUNT: 'CURRENT_ACCOUNT',
    UNSEASONALLY_MERCHANDISE_TRADE_ACCOUNT: 'MERCHANDISE_TRADE_ACCOUNT',
    UNSEASONALLY_TRADE_ACCOUNT: 'TRADE_BALANCE',
    UNSEASONALLY_UNEMPLOYMENT_RATE: 'UNEMPLOYMENT_RATE',
    TRANSMUTATION_IN_SEASONALLY_UNEMPLOYMENT: 'UNEMPLOYMENT',
    UNSEASONALLY_HOUSE_PRICE_MAJOR: 'HOUSE_PRICE',
    UNSEASONALLY_IVEY_PURCHASING_MANAGERS: 'IVEY_PURCHASING_MANAGERS',
    NON_SEASONALLY_PRODUCER_INPUT: 'PRODUCER_PRICE',
    NON_SEASONALLY_PRODUCER_OUTPUT: 'PRODUCER_PRICE',
    CORE_CONSUMER_PRICE_TUNER: 'CORE_CONSUMER_PRICE',
    /** 地区联储与机构的权威拼法（既有码这么写的，源里换了拼法不许另建一个码）。 */
    PHILADELPHIA_FED_MANUFACTURING: 'PHILLY_FED_MANUFACTURING',
    DALLAS_FED_MANUFACTURING_RAW: 'DALLAS_FED_MANUFACTURING',
    NEW_YORK_FED_MANUFACTURING: 'EMPIRE_STATE_MANUFACTURING',
    NEW_YORK_FEDERAL_RESERVE: 'EMPIRE_STATE_MANUFACTURING'
  } as Readonly<Record<string, string>>),
  /**
   * **名义与实际进族名，不进测度列**（用户 2026-11-18 定）：`REAL_GDP` / `NOMINAL_GDP` 各自成族。
   * 测度列已经承载月率/年率/季率/水平/数量，再塞价格口径会让测度集合成倍扩大，还会掩盖
   * 「这是另一个指标」这件事。**只有同一国家内两种口径同时存在时才建这两个族**；
   * 只有一种、源又没标明名义还是实际 → `pending:price-basis-unknown`，不许猜。
   */
  priceBasisFamilies: Object.freeze(['REAL_', 'NOMINAL_'] as const),
  /**
   * **PMI 按发布机构分族**（`ISM_` / `SP_` / `CAIXIN_` / `CIPS_`）：机构不同就是不同指标，
   * 面板与发布日都不同。绝不并成 `MANUFACTURING_PURCHASING_MANAGERS`。
   */
  pmiInstitutions: Object.freeze(['ISM_', 'SP_', 'CAIXIN_', 'CIPS_'] as const),
  /** 真的没有信息量：不进词表、不建码。 */
  reject: Object.freeze(['Q', 'SK', 'ASIC', 'APEC', 'GTC', 'CEO', 'MARTIN', 'MARNIE_BAKER_AM', 'IMF', 'IMF_IMF', 'IEA'] as const)
})

export type FamilyVerdict =
  | Readonly<{ kind: 'adopt' | 'country-specific'; family: string }>
  | Readonly<{ kind: 'merge'; family: string }>
  | Readonly<{ kind: 'reject' }>
  | Readonly<{ kind: 'unlisted' }>

/** 生成器的唯一入口：族名必须先过这张词表，过不了就是 `unlisted`（进待定，不建码）。 */
export function familyVerdictFor(rawFamily: string): FamilyVerdict {
  const family = rawFamily.trim().toUpperCase()
  const merged = marketCalendarFamilyVocabulary.mergeAliases[family]
  if (merged !== undefined) return { kind: 'merge', family: merged }
  if ((marketCalendarFamilyVocabulary.adopt as readonly string[]).includes(family)) return { kind: 'adopt', family }
  if ((marketCalendarFamilyVocabulary.countrySpecific as readonly string[]).includes(family)) {
    return { kind: 'country-specific', family }
  }
  if ((marketCalendarFamilyVocabulary.reject as readonly string[]).includes(family)) return { kind: 'reject' }
  return { kind: 'unlisted' }
}
