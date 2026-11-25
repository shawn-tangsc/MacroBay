import type { ZeroXRouterPeriodRule } from '../marketCalendarMetricIdentity'

/**
 * 按国家拆开的「源内 id → 码」映射（CN）。**数据型注册表，纯声明**：一行一个源内身份。
 *
 * 只收期次可定、测度一致的映射；目标码必须存在于码表（守卫在索引里断）。
 */
export const mapping_CN: Readonly<Record<string, Readonly<{ metricKey: string; periodRule: ZeroXRouterPeriodRule }>>> = Object.freeze({
  '213771': { metricKey: 'CN.FOREIGN_EXCHANGE_RESERVES_END_YEAR.NONE.AMOUNT', periodRule: 'month' },
  '213831': { metricKey: 'CN.END_M0_MONEY_SUPPLY.NONE.YOY', periodRule: 'month' },
  '213832': { metricKey: 'CN.END_M1_MONEY_SUPPLY.NONE.YOY', periodRule: 'month' },
  '213833': { metricKey: 'CN.INCREMENT_SOCIAL_FINANCING_SCALE_YTD.NONE.AMOUNT', periodRule: 'month' },
  '213834': { metricKey: 'CN.M2_MONEY_SUPPLY_END_YEAR.NONE.YOY', periodRule: 'month' },
  '213835': { metricKey: 'CN.NEW_RMB_LOANS_YTD.NONE.AMOUNT', periodRule: 'month' },
  '213857': { metricKey: 'CN.EX_FACTORY_PRICE_INDUSTRIAL_PRODUCTS.NONE.YOY', periodRule: 'month' },
  '213858': { metricKey: 'CN.EX_FACTORY_PRICE_INDUSTRIAL_PRODUCTS.NONE.MOM', periodRule: 'month' },
  '213859': { metricKey: 'CN.CONSUMER_PRICE_RESIDENTS.NONE.YOY', periodRule: 'month' },
  '213860': { metricKey: 'CN.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '213861': { metricKey: 'CN.TRADE_BALANCE.NONE.LEVEL', periodRule: 'month' },
  '213862': { metricKey: 'CN.USD_DENOMINATED_EXPORTS.NONE.YOY', periodRule: 'month' },
  '213864': { metricKey: 'CN.USD_DENOMINATED_IMPORTS.NONE.YOY', periodRule: 'month' },
  '213866': { metricKey: 'CN.RMB_DENOMINATED_EXPORTS.NONE.YOY', periodRule: 'month' },
  '213867': { metricKey: 'CN.RENMINBI_DENOMINATED_IMPORTS.NONE.YOY', periodRule: 'month' },
  '213868': { metricKey: 'CN.TRADE_BALANCE.NONE.LEVEL', periodRule: 'month' },
  '214027': { metricKey: 'CN.INDUSTRIAL_ADDED_VALUE_DESIGNATED_SIZE.NONE.YOY', periodRule: 'month' },
  '214028': { metricKey: 'CN.ADDED_VALUE_INDUSTRIES_DESIGNATED_SIZE.NONE.MOM', periodRule: 'month' },
  '214029': { metricKey: 'CN.URBAN_FIXED_ASSET_INVESTMENT_YTD.NONE.YOY', periodRule: 'month' },
  '214030': { metricKey: 'CN.URBAN_FIXED_ASSET_INVESTMENT.NONE.MOM', periodRule: 'month' },
  '214031': { metricKey: 'CN.GDP.NONE.QOQ', periodRule: 'quarter' },
  '214032': { metricKey: 'CN.GDP.NONE.YOY', periodRule: 'month' },
  '214033': { metricKey: 'CN.TOTAL_RETAIL_SALES_CONSUMER_GOODS.NONE.YOY', periodRule: 'month' },
  '214034': { metricKey: 'CN.TOTAL_RETAIL_SALES_CONSUMER_GOODS.NONE.MOM', periodRule: 'month' },
  '214355': { metricKey: 'CN.MANUFACTURING_PURCHASING_MANAGERS.NONE.LEVEL', periodRule: 'month' },
  '214379': { metricKey: 'CN.SP_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '214425': { metricKey: 'CN.SP_SERVICES_PMI.NONE.LEVEL', periodRule: 'month' },
  '214523': { metricKey: 'CN.FOREIGN_EXCHANGE_RESERVES_END_YEAR.NONE.AMOUNT', periodRule: 'month' },
  '214540': { metricKey: 'CN.EX_FACTORY_PRICE_INDUSTRIAL_PRODUCTS.NONE.YOY', periodRule: 'month' },
  '214541': { metricKey: 'CN.EX_FACTORY_PRICE_INDUSTRIAL_PRODUCTS.NONE.MOM', periodRule: 'month' },
  '214542': { metricKey: 'CN.CONSUMER_PRICE_RESIDENTS.NONE.YOY', periodRule: 'month' },
  '214543': { metricKey: 'CN.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '214569': { metricKey: 'CN.TRADE_BALANCE.NONE.LEVEL', periodRule: 'month' },
  '214570': { metricKey: 'CN.USD_DENOMINATED_EXPORTS.NONE.YOY', periodRule: 'month' },
  '214572': { metricKey: 'CN.USD_DENOMINATED_IMPORTS.NONE.YOY', periodRule: 'month' },
  '214574': { metricKey: 'CN.RMB_DENOMINATED_EXPORTS.NONE.YOY', periodRule: 'month' },
  '214575': { metricKey: 'CN.RENMINBI_DENOMINATED_IMPORTS.NONE.YOY', periodRule: 'month' },
  '214576': { metricKey: 'CN.TRADE_BALANCE.NONE.LEVEL', periodRule: 'month' },
  '214577': { metricKey: 'CN.END_M0_MONEY_SUPPLY.NONE.YOY', periodRule: 'month' },
  '214578': { metricKey: 'CN.END_M1_MONEY_SUPPLY.NONE.YOY', periodRule: 'month' },
  '214579': { metricKey: 'CN.INCREMENT_SOCIAL_FINANCING_SCALE_YTD.NONE.AMOUNT', periodRule: 'month' },
  '214580': { metricKey: 'CN.M2_MONEY_SUPPLY_END_YEAR.NONE.YOY', periodRule: 'month' },
  '214581': { metricKey: 'CN.NEW_RMB_LOANS_YTD.NONE.AMOUNT', periodRule: 'month' },
  '214766': { metricKey: 'CN.TOTAL_RETAIL_SALES_CONSUMER_GOODS.NONE.YOY', periodRule: 'month' },
  '214767': { metricKey: 'CN.INDUSTRIAL_ADDED_VALUE_DESIGNATED_SIZE.NONE.YOY', periodRule: 'month' },
  '214768': { metricKey: 'CN.ADDED_VALUE_INDUSTRIES_DESIGNATED_SIZE.NONE.MOM', periodRule: 'month' },
  '214769': { metricKey: 'CN.TOTAL_RETAIL_SALES_CONSUMER_GOODS.NONE.MOM', periodRule: 'month' },
  '214770': { metricKey: 'CN.URBAN_FIXED_ASSET_INVESTMENT.NONE.MOM', periodRule: 'month' },
  '214771': { metricKey: 'CN.URBAN_FIXED_ASSET_INVESTMENT_YTD.NONE.YOY', periodRule: 'month' },
  '10280': { metricKey: 'CN.PROFITS_INDUSTRIAL_ENTERPRISES_DESIGNATED_SIZE.NONE.LEVEL', periodRule: 'month' },  // 2 行 · 1-9月规模以上工业企业利润 | 1-10月规模以上工业企业利润
  '10303': { metricKey: 'CN.EX_FACTORY_PRICE_INDUSTRIAL_PRODUCTS.NONE.MOM', periodRule: 'month' },  // 4 行 · 9月工业生产者出厂价格指数(月率) | Sep月工业生产者出厂价格指数(月率)
  '4080': { metricKey: 'CN.MANUFACTURING_PURCHASING_MANAGERS.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月官方制造业采购经理人指数 | 11月官方制造业采购经理人指数
  '4084': { metricKey: 'CN.EXPORTS.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 9月出口(亿美元) | 10月出口(亿美元)
  '4085': { metricKey: 'CN.IMPORTS.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 9月进口(亿美元) | 10月进口(亿美元)
  '4086': { metricKey: 'CN.TRADE_BALANCE.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 9月贸易帐(十亿美元) | 10月贸易帐(十亿美元)
  '4104': { metricKey: 'CN.CONSUMER_PRICE_RESIDENTS.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月居民消费品价格指数(年率) | 10月居民消费品价格指数(年率)
  '8608': { metricKey: 'CN.SP_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'current_month' },  // 1 行 · 10月标普全球制造业采购经理人指数
  '8672': { metricKey: 'CN.EX_FACTORY_PRICE_INDUSTRIAL_PRODUCTS.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月工业生产者出厂价格指数(年率) | 10月工业生产者出厂价格指数(年率)
  '9387': { metricKey: 'CN.USD_DENOMINATED_EXPORTS.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月美元计价出口（年率） | 10月美元计价出口（年率）
  '9388': { metricKey: 'CN.USD_DENOMINATED_IMPORTS.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月美元计价进口（年率） | 10月美元计价进口（年率）
  '9390': { metricKey: 'CN.INDUSTRIAL_ADDED_VALUE_DESIGNATED_SIZE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月规模以上工业增加值(年率) | 10月规模以上工业增加值(年率)
  '9391': { metricKey: 'CN.ADDED_VALUE_INDUSTRIES_DESIGNATED_SIZE.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月规模以上工业增加值(月率) | 10月规模以上工业增加值(月率)
  '9761': { metricKey: 'CN.END_M0_MONEY_SUPPLY.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月末M0货币供应(年率) | 10月末M0货币供应(年率)
  '9762': { metricKey: 'CN.END_M1_MONEY_SUPPLY.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月末M1货币供应(年率) | 10月末M1货币供应(年率)
  '9763': { metricKey: 'CN.M2_MONEY_SUPPLY_END_YEAR.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月末M2货币供应(年率) | 10月末M2货币供应(年率)
  '9764': { metricKey: 'CN.PROFITS_INDUSTRIAL_ENTERPRISES_DESIGNATED_SIZE.NONE.LEVEL', periodRule: 'month' },  // 3 行 · 7月规模以上工业企业利润 | 9月规模以上工业企业利润
  '9781': { metricKey: 'CN.TOTAL_RETAIL_SALES_CONSUMER_GOODS.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月社会消费品零售总额(年率) | 10月社会消费品零售总额(年率)
  '9782': { metricKey: 'CN.TOTAL_RETAIL_SALES_CONSUMER_GOODS.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月社会消费品零售总额(月率) | 10月社会消费品零售总额(月率)
  '9783': { metricKey: 'CN.URBAN_FIXED_ASSET_INVESTMENT.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月城镇固定资产投资(月率) | 10月城镇固定资产投资(月率)
  '9785': { metricKey: 'CN.GDP.NONE.YOY', periodRule: 'quarter' },  // 1 行 · 第三季度国内生产总值(年率)
  '9786': { metricKey: 'CN.GDP.NONE.QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度国内生产总值(季率)
  '9818': { metricKey: 'CN.FOREIGN_EXCHANGE_RESERVES_END_YEAR.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 9月底外汇储备(十亿美元) | 10月底外汇储备(十亿美元)
  '9832': { metricKey: 'CN.SP_SERVICES_PMI.NONE.LEVEL', periodRule: 'current_month' },  // 1 行 · 10月标普全球服务业采购经理人指数
  '9879': { metricKey: 'CN.PROFIT_INDUSTRIAL_ENTERPRISES_DESIGNATED_SIZE.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 1-9月规模以上工业企业利润(亿元) | 1-10月规模以上工业企业利润(亿元)
  '9897': { metricKey: 'CN.TRADE_BALANCE.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 9月贸易帐(十亿元) | 10月贸易帐(十亿元)
  '9898': { metricKey: 'CN.RENMINBI_DENOMINATED_IMPORTS.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月人民币计价进口（年率） | 10月人民币计价进口（年率）
  '9899': { metricKey: 'CN.RMB_DENOMINATED_EXPORTS.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月人民币计价出口（年率） | 10月人民币计价出口（年率）
  '9919': { metricKey: 'CN.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月居民消费品价格指数(月率) | 10月居民消费品价格指数(月率)
})
