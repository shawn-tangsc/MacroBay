import type { ZeroXRouterPeriodRule } from '../marketCalendarMetricIdentity'

/**
 * 按国家拆开的「源内 id → 码」映射（US）。**数据型注册表，纯声明**：一行一个源内身份。
 *
 * 只收期次可定、测度一致的映射；目标码必须存在于码表（守卫在索引里断）。
 */
export const mapping_US: Readonly<Record<string, Readonly<{ metricKey: string; periodRule: ZeroXRouterPeriodRule }>>> = Object.freeze({
  '213593': { metricKey: 'US.PERSONAL_CONSUMPTION_EXPENDITURE.NONE.MOM', periodRule: 'month' },
  '213981': { metricKey: 'US.NET_LONG_TERM_CAPITAL_INFLOWS.NONE.AMOUNT', periodRule: 'month' },
  '213982': { metricKey: 'US.NET_FOREIGN_PURCHASES_GOVERNMENT_BONDS.NONE.AMOUNT', periodRule: 'month' },
  '213983': { metricKey: 'US.NET_INTERNATIONAL_CAPITAL_INFLOW.NONE.AMOUNT', periodRule: 'month' },
  '214060': { metricKey: 'US.TOTAL_NUMBER_CONSTRUCTION_PERMITS.NONE.COUNT', periodRule: 'month' },
  '214117': { metricKey: 'US.COINCIDENT_INDEX.NONE.MOM', periodRule: 'month' },
  '214118': { metricKey: 'US.CONFERENCE_BOARD_LAG_METRIC.NONE.MOM', periodRule: 'month' },
  '214221': { metricKey: 'US.DEDUCT_AIRCRAFT_DEFENSE_CAPITAL_DURABLE_GOODS_ORDERS.NONE.MOM', periodRule: 'month' },
  '214222': { metricKey: 'US.DURABLE_GOODS_ORDERS_EXCLUDING_NATIONAL_DEFENSE.NONE.MOM', periodRule: 'month' },
  '214223': { metricKey: 'US.DURABLE_GOODS_ORDERS.NONE.MOM', periodRule: 'month' },
  '214224': { metricKey: 'US.DURABLE_GOODS_ORDERS_EXCLUDING_TRANSPORTATION.NONE.MOM', periodRule: 'month' },
  '214229': { metricKey: 'US.UNSEASONALLY_HOUSE_PRICE_20_MAJOR_CITIES_S_P_CS.NSA.MOM', periodRule: 'month' },
  '214230': { metricKey: 'US.S_P_CS_HOUSE_PRICE_10_MAJOR_CITIES.NONE.YOY', periodRule: 'month' },
  '214231': { metricKey: 'US.S_P_CS_UNSEASONALLY_HOUSE_PRICE_10_MAJOR_CITIES.NSA.MOM', periodRule: 'month' },
  '214236': { metricKey: 'US.NEW_HOME_SALES_ANNUALIZED.NONE.COUNT', periodRule: 'month' },
  '214277': { metricKey: 'US.REAL_GDP.NONE.ANNUALIZED_QOQ', periodRule: 'quarter' },
  '214278': { metricKey: 'US.ANNUM_REAL_GDP.NONE.AMOUNT', periodRule: 'month' },
  '214282': { metricKey: 'US.CORE_PERSONAL_CONSUMPTION_EXPENDITURE_PRICE.NONE.ANNUALIZED_QOQ', periodRule: 'quarter' },
  '214283': { metricKey: 'US.PERSONAL_CONSUMPTION_EXPENDITURE_PRICE.NONE.ANNUALIZED_QOQ', periodRule: 'quarter' },
  '214287': { metricKey: 'US.ACTUAL_PERSONAL_CONSUMPTION_EXPENDITURE.NONE.MOM', periodRule: 'month' },
  '214288': { metricKey: 'US.CORE_PERSONAL_CONSUMPTION_EXPENDITURE_PRICE.NONE.MOM', periodRule: 'month' },
  '214289': { metricKey: 'US.PERSONAL_CONSUMPTION_EXPENDITURE.NONE.MOM', periodRule: 'month' },
  '214290': { metricKey: 'US.CORE_PERSONAL_CONSUMPTION_EXPENDITURE_PRICE.NONE.YOY', periodRule: 'month' },
  '214291': { metricKey: 'US.PERSONAL_CONSUMPTION_EXPENDITURE_PRICE.NONE.MOM', periodRule: 'month' },
  '214292': { metricKey: 'US.PERSONAL_CONSUMPTION_EXPENDITURE_PRICE.NONE.YOY', periodRule: 'month' },
  '214689': { metricKey: 'US.NEW_HOME_STARTS_ANNUALIZED.NONE.COUNT', periodRule: 'month' },
  '214710': { metricKey: 'US.FEDERAL_FUNDS_BENCHMARK.NONE.RATE', periodRule: 'month' },
  '214862': { metricKey: 'US.TOTAL_NUMBER_CONSTRUCTION_PERMITS.NONE.COUNT', periodRule: 'month' },
  '214863': { metricKey: 'US.NEW_HOME_STARTS_ANNUALIZED.NONE.COUNT', periodRule: 'month' },
  '214867': { metricKey: 'US.NET_LONG_TERM_CAPITAL_INFLOWS.NONE.AMOUNT', periodRule: 'month' },
  '214868': { metricKey: 'US.NET_FOREIGN_PURCHASES_GOVERNMENT_BONDS.NONE.AMOUNT', periodRule: 'month' },
  '214869': { metricKey: 'US.NET_INTERNATIONAL_CAPITAL_INFLOW.NONE.AMOUNT', periodRule: 'month' },
  '214913': { metricKey: 'US.COINCIDENT_INDEX.NONE.MOM', periodRule: 'month' },
  '214914': { metricKey: 'US.CONFERENCE_BOARD_LAG_METRIC.NONE.MOM', periodRule: 'month' },
  '214988': { metricKey: 'US.UNSEASONALLY_HOUSE_PRICE_20_MAJOR_CITIES_S_P_CS.NSA.MOM', periodRule: 'month' },
  '214989': { metricKey: 'US.S_P_CS_HOUSE_PRICE_10_MAJOR_CITIES.NONE.YOY', periodRule: 'month' },
  '214990': { metricKey: 'US.S_P_CS_UNSEASONALLY_HOUSE_PRICE_10_MAJOR_CITIES.NSA.MOM', periodRule: 'month' },
  '215011': { metricKey: 'US.DEDUCT_AIRCRAFT_DEFENSE_CAPITAL_DURABLE_GOODS_ORDERS.NONE.MOM', periodRule: 'month' },
  '215012': { metricKey: 'US.DURABLE_GOODS_ORDERS_EXCLUDING_NATIONAL_DEFENSE.NONE.MOM', periodRule: 'month' },
  '215013': { metricKey: 'US.DURABLE_GOODS_ORDERS.NONE.MOM', periodRule: 'month' },
  '215014': { metricKey: 'US.DURABLE_GOODS_ORDERS_EXCLUDING_TRANSPORTATION.NONE.MOM', periodRule: 'month' },
  '215015': { metricKey: 'US.REAL_GDP.NONE.ANNUALIZED_QOQ', periodRule: 'quarter' },
  '215016': { metricKey: 'US.ANNUM_REAL_GDP.NONE.AMOUNT', periodRule: 'month' },
  '215020': { metricKey: 'US.CORE_PERSONAL_CONSUMPTION_EXPENDITURE_PRICE.NONE.ANNUALIZED_QOQ', periodRule: 'quarter' },
  '215021': { metricKey: 'US.PERSONAL_CONSUMPTION_EXPENDITURE_PRICE.NONE.ANNUALIZED_QOQ', periodRule: 'quarter' },
  '215022': { metricKey: 'US.ACTUAL_PERSONAL_CONSUMPTION_EXPENDITURE.NONE.MOM', periodRule: 'month' },
  '215023': { metricKey: 'US.CORE_PERSONAL_CONSUMPTION_EXPENDITURE_PRICE.NONE.MOM', periodRule: 'month' },
  '215024': { metricKey: 'US.PERSONAL_CONSUMPTION_EXPENDITURE.NONE.MOM', periodRule: 'month' },
  '215025': { metricKey: 'US.CORE_PERSONAL_CONSUMPTION_EXPENDITURE_PRICE.NONE.YOY', periodRule: 'month' },
  '215026': { metricKey: 'US.PERSONAL_CONSUMPTION_EXPENDITURE_PRICE.NONE.MOM', periodRule: 'month' },
  '215027': { metricKey: 'US.PERSONAL_CONSUMPTION_EXPENDITURE_PRICE.NONE.YOY', periodRule: 'month' },
  '215030': { metricKey: 'US.NEW_HOME_SALES_ANNUALIZED.NONE.COUNT', periodRule: 'month' },
  '215071': { metricKey: 'US.WHOLESALE_INVENTORY.NONE.MOM', periodRule: 'month' },
  '10042': { metricKey: 'US.GDP_DEFLATOR.NONE.LEVEL', periodRule: 'quarter' },  // 1 行 · 第三季度GDP平减指数初值
  '10043': { metricKey: 'US.GDP_DEFLATOR.NONE.LEVEL', periodRule: 'quarter' },  // 1 行 · 第三季度GDP平减指数修正值
  '10045': { metricKey: 'US.CORE_PERSONAL_CONSUMPTION_EXPENDITURE_PRICE.NONE.ANNUALIZED_QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度核心个人消费支出物价指数初值(年化季率)
  '10046': { metricKey: 'US.CORE_PERSONAL_CONSUMPTION_EXPENDITURE_PRICE.NONE.ANNUALIZED_QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度核心个人消费支出物价指数修正值(年化季率)
  '10048': { metricKey: 'US.PERSONAL_CONSUMPTION_EXPENDITURE_PRICE.NONE.ANNUALIZED_QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度个人消费支出物价指数初值(年化季率)
  '10049': { metricKey: 'US.PERSONAL_CONSUMPTION_EXPENDITURE_PRICE.NONE.ANNUALIZED_QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度个人消费支出物价指数修正值(年化季率)
  '10096': { metricKey: 'US.MARKIT_MANUFACTURING_PURCHASING_MANAGERS.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月标普全球制造业采购经理人指数初值 | 11月标普全球制造业采购经理人指数初值
  '10099': { metricKey: 'US.DURABLE_GOODS_ORDERS_EXCLUDING_TRANSPORTATION.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月扣除运输的耐用品订单初值(月率) | 10月扣除运输的耐用品订单初值(月率)
  '10102': { metricKey: 'US.DEDUCT_AIRCRAFT_DEFENSE_CAPITAL_DURABLE_GOODS_ORDERS.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月扣除飞机非国防资本耐用品订单初值(月率) | 10月扣除飞机非国防资本耐用品订单初值
  '10105': { metricKey: 'US.DURABLE_GOODS_ORDERS_EXCLUDING_NATIONAL_DEFENSE.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月扣除国防的耐用品订单初值(月率) | 10月扣除国防的耐用品订单初值(月率)
  '10108': { metricKey: 'US.WHOLESALE_INVENTORY.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月批发库存(月率)初值 | 10月批发库存(月率)初值
  '10113': { metricKey: 'US.MICHIGAN_CURRENT.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月密歇根大学现况指数终值 | 11月密歇根大学现况指数终值
  '10116': { metricKey: 'US.MICHIGAN_EXPECTATIONS.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月密歇根大学预期指数终值 | 11月密歇根大学预期指数终值
  '10234': { metricKey: 'US.DURABLE_GOODS_ORDERS.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月耐用品订单初值(月率) | 10月耐用品订单初值(月率)
  '10258': { metricKey: 'US.MARKIT_SERVICES_PURCHASING_MANAGERS.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月标普全球服务业采购经理人指数初值 | 11月标普全球服务业采购经理人指数初值
  '10261': { metricKey: 'US.MARKIT_COMPOSITE_PURCHASING_MANAGERS.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月标普全球综合采购经理人指数初值 | 11月标普全球综合采购经理人指数初值
  '10266': { metricKey: 'US.MICHIGAN_INFLATION_1Y.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月密歇根大学1年通胀预期终值 | 11月密歇根大学1年通胀预期终值
  '10269': { metricKey: 'US.MICHIGAN_INFLATION_5Y.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月密歇根大学5-10年通胀预期终值 | 11月密歇根大学5-10年通胀预期终值
  '4011': { metricKey: 'US.RETAIL_SALES.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 9月零售销售(亿美元) | 10月零售销售(亿美元)
  '4017': { metricKey: 'US.NEW_HOME_STARTS_ANNUALIZED.NONE.COUNT', periodRule: 'month' },  // 2 行 · 9月新屋开工总数年化(千户) | 10月新屋开工总数年化(千户)
  '4018': { metricKey: 'US.NEW_HOME_SALES_ANNUALIZED.NONE.COUNT', periodRule: 'month' },  // 2 行 · 9月新屋销售总数年化(千户) | 10月新屋销售总数年化(千户)
  '4037': { metricKey: 'US.CONFERENCE_BOARD_LEADING_ECONOMIC.NONE.LEVEL', periodRule: 'month' },  // 3 行 · 8月谘商会领先指标 | 9月谘商会领先指标
  '4240': { metricKey: 'US.FEDERAL_FUNDS_BENCHMARK.NONE.RATE', periodRule: 'month' },  // 2 行 · 联邦基金基准利率 | Federal Funds Benchmark Rate
  '8657': { metricKey: 'US.RETAIL_SALES.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月零售销售(月率) | 10月零售销售(月率)
  '8658': { metricKey: 'US.CORE_RETAIL_SALES.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月核心零售销售(月率) | 10月核心零售销售(月率)
  '9277': { metricKey: 'US.NET_LONG_TERM_CAPITAL_INFLOWS.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 8月长期资本净流入(十亿美元) | 9月长期资本净流入(十亿美元)
  '9279': { metricKey: 'US.NET_FOREIGN_PURCHASES_GOVERNMENT_BONDS.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 8月外资净买入公债(亿美元) | 9月外资净买入公债(亿美元)
  '9280': { metricKey: 'US.NET_INTERNATIONAL_CAPITAL_INFLOW.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 8月国际资本净流入(亿美元) | 9月国际资本净流入(亿美元)
  '9283': { metricKey: 'US.NEW_HOUSING_STARTS.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月新屋开工(年化月率) | 10月新屋开工(年化月率)
  '9291': { metricKey: 'US.NEW_HOME_SALES.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月新屋销售(年化月率) | 10月新屋销售(年化月率)
  '9299': { metricKey: 'US.NAR_EXISTING_HOME_CONTRACTED_SALES.SA.MOM', periodRule: 'month' },  // 2 行 · 9月NAR季调后成屋签约销售指数(月率) | 10月NAR季调后成屋签约销售指数(月率)
  '9301': { metricKey: 'US.NAR_EXISTING_HOME_SIGNED_SALES.SA.LEVEL', periodRule: 'month' },  // 2 行 · 9月NAR季调后成屋签约销售指数 | 10月NAR季调后成屋签约销售指数
  '9303': { metricKey: 'US.NAR_EXISTING_HOME_SIGNED_SALES.SA.YOY', periodRule: 'month' },  // 2 行 · 9月NAR季调后成屋签约销售指数(年率) | 10月NAR季调后成屋签约销售指数(年率)
  '9304': { metricKey: 'US.CONSUMER_CONFIDENCE.EXPECTATIONS.SA.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月谘商会消费者预期指数 | 11月谘商会消费者预期指数
  '9305': { metricKey: 'US.CONFERENCE_BOARD_CONSUMER_CONFIDENCE.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月谘商会消费者信心指数 | 11月谘商会消费者信心指数
  '9306': { metricKey: 'US.CONSUMER_CONFIDENCE.CURRENT.SA.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月谘商会消费者现况指数 | 11月谘商会消费者现况指数
  '9308': { metricKey: 'US.CORE_RETAIL_SALES.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 9月核心零售销售(亿美元) | 10月核心零售销售(亿美元)
  '9309': { metricKey: 'US.ACTUAL_PERSONAL_CONSUMPTION_EXPENDITURE.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月实际个人消费支出(月率) | 10月实际个人消费支出(月率)
  '9310': { metricKey: 'US.PERSONAL_CONSUMPTION_EXPENDITURE_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月个人消费支出物价指数(年率) | 10月个人消费支出物价指数(年率)
  '9311': { metricKey: 'US.PERSONAL_CONSUMPTION_EXPENDITURE_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月个人消费支出物价指数(月率) | 10月个人消费支出物价指数(月率)
  '9312': { metricKey: 'US.CORE_PERSONAL_CONSUMPTION_EXPENDITURE_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月核心个人消费支出物价指数(年率) | 10月核心个人消费支出物价指数(年率)
  '9313': { metricKey: 'US.CORE_PERSONAL_CONSUMPTION_EXPENDITURE_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月核心个人消费支出物价指数(月率) | 10月核心个人消费支出物价指数(月率)
  '9314': { metricKey: 'US.CHICAGO_PMI.SA.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月芝加哥采购经理人指数 | 11月芝加哥采购经理人指数
  '9444': { metricKey: 'US.IMPORTS_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月进口物价指数(年率) | 10月进口物价指数(年率)
  '9445': { metricKey: 'US.IMPORTS_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月进口物价指数(月率) | 10月进口物价指数(月率)
  '9446': { metricKey: 'US.EXPORTS_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月出口物价指数(月率) | 10月出口物价指数(月率)
  '9448': { metricKey: 'US.CAPACITY_UTILIZATION.SA.RATE', periodRule: 'month' },  // 2 行 · 9月产能利用率 | 10月产能利用率
  '9449': { metricKey: 'US.EMPIRE_STATE_MANUFACTURING.SA.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月纽约联储制造业指数 | 11月纽约联储制造业指数
  '9450': { metricKey: 'US.EMPIRE_STATE_MANUFACTURING.EMPLOYMENT.SA.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月纽约联储制造业就业指数 | 11月纽约联储制造业就业指数
  '9451': { metricKey: 'US.EMPIRE_STATE_MANUFACTURING.PRICES_PAID.SA.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月纽约联储制造业物价支付指数 | 11月纽约联储制造业物价支付指数
  '9452': { metricKey: 'US.EMPIRE_STATE_MANUFACTURING.NEW_ORDERS.SA.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月纽约联储制造业新订单指数 | 11月纽约联储制造业新订单指数
  '9455': { metricKey: 'US.NAHB_HOUSE_PRICE.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月NAHB房价指数 | 11月NAHB房价指数
  '9457': { metricKey: 'US.PHILLY_FED_MANUFACTURING.SA.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月费城联储制造业指数 | 11月费城联储制造业指数
  '9458': { metricKey: 'US.PHILLY_FED_MANUFACTURING.NEW_ORDERS.SA.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月费城联储制造业新订单指数 | 11月费城联储制造业新订单指数
  '9459': { metricKey: 'US.PHILLY_FED_MANUFACTURING.PRICES_PAID.SA.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月费城联储制造业物价支付指数 | 11月费城联储制造业物价支付指数
  '9460': { metricKey: 'US.PHILLY_FED_MANUFACTURING.PRICES_RECEIVED.SA.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月费城联储制造业物价获得指数 | 11月费城联储制造业物价获得指数
  '9461': { metricKey: 'US.PHILLY_FED_MANUFACTURING.EMPLOYMENT.SA.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月费城联储制造业就业指数 | 11月费城联储制造业就业指数
  '9462': { metricKey: 'US.PHILLY_FED_MANUFACTURING.SHIPMENTS.SA.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月费城联储制造业装船指数 | 11月费城联储制造业装船指数
  '9463': { metricKey: 'US.CONFERENCE_BOARD_LEADING_METRIC.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月谘商会领先指标(月率) | 10月谘商会领先指标(月率)
  '9464': { metricKey: 'US.COINCIDENT_INDEX.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月谘商会同步指标(月率) | 10月谘商会同步指标(月率)
  '9465': { metricKey: 'US.CONFERENCE_BOARD_LAG_METRIC.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月谘商会滞后指标(月率) | 10月谘商会滞后指标(月率)
  '9467': { metricKey: 'US.RICHMOND_FED_MANUFACTURING.SA.LEVEL', periodRule: 'current_month' },  // 3 行 · 8月里奇蒙德联储制造业指数 | 10月里奇蒙德联储制造业指数
  '9468': { metricKey: 'US.RICHMOND_FED_MANUFACTURING_SHIPMENTS.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月里奇蒙德联储制造业装船指数 | 11月里奇蒙德联储制造业装船指数
  '9469': { metricKey: 'US.RICHMOND_FED_SERVICES_REVENUE.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月里奇蒙德联储服务业收入指数 | 11月里奇蒙德联储服务业收入指数
  '9471': { metricKey: 'US.CHICAGO_FED_NATIONAL_ACTIVITY.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 9月芝加哥联储全国活动指数 | 10月芝加哥联储全国活动指数
  '9472': { metricKey: 'US.DALLAS_FED_MANUFACTURING.PRODUCTION.SA.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月达拉斯联储制造业产出指数 | 11月达拉斯联储制造业产出指数
  '9473': { metricKey: 'US.DALLAS_FED_MANUFACTURING.SHIPMENTS.SA.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月达拉斯联储制造业装船指数 | 11月达拉斯联储制造业装船指数
  '9474': { metricKey: 'US.DALLAS_FED_CONSUMER_PRICE.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月达拉斯联储制成品价格指数 | 11月达拉斯联储制成品价格指数
  '9475': { metricKey: 'US.DALLAS_FED_MANUFACTURING.EMPLOYMENT.SA.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月达拉斯联储制造业就业指数 | 11月达拉斯联储制造业就业指数
  '9476': { metricKey: 'US.DALLAS_FED_MANUFACTURING.PRICES_PAID.SA.LEVEL', periodRule: 'current_month' },  // 3 行 · Dallas Fed Manufacturing Raw material（m）Paym
  '9477': { metricKey: 'US.DALLAS_FED_NEW_ORDERS.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月达拉斯联储新订单指数 | 11月达拉斯联储新订单指数
  '9480': { metricKey: 'US.S_P_CS_HOUSE_PRICE_20_MAJOR_CITIES.NONE.YOY', periodRule: 'month' },  // 2 行 · 8月S&P/CS20座大城市房价指数(年率) | 9月S&P/CS20座大城市房价指数(
  '9481': { metricKey: 'US.UNSEASONALLY_HOUSE_PRICE_20_MAJOR_CITIES_S_P_CS.NSA.MOM', periodRule: 'month' },  // 2 行 · 8月S&P/CS20座大城市未季调房价指数(月率) | 9月S&P/CS20座大城市未季
  '9482': { metricKey: 'US.S_P_CS_HOUSE_PRICE_10_MAJOR_CITIES.NONE.YOY', periodRule: 'month' },  // 2 行 · 8月S&P/CS10座大城市房价指数(年率) | 9月S&P/CS10座大城市房价指数(
  '9483': { metricKey: 'US.S_P_CS_UNSEASONALLY_HOUSE_PRICE_10_MAJOR_CITIES.NSA.MOM', periodRule: 'month' },  // 2 行 · 8月S&P/CS10座大城市未季调房价指数(月率) | 9月S&P/CS10座大城市未季
  '9484': { metricKey: 'US.KANSAS_FEDERAL_RESERVE_MANUFACTURING_COMPOSITE.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月堪萨斯联储制造业综合指数 | 11月堪萨斯联储制造业综合指数
  '9485': { metricKey: 'US.KANSAS_FED_MANUFACTURING.PRODUCTION.SA.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月堪萨斯联储制造业产出指数 | 11月堪萨斯联储制造业产出指数
  '9765': { metricKey: 'US.COMMERCIAL_INVENTORY.NONE.MOM', periodRule: 'month' },  // 2 行 · 8月商业库存(月率) | 9月商业库存(月率)
  '9767': { metricKey: 'US.INDUSTRIAL_OUTPUT.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月工业产出(月率) | 10月工业产出(月率)
  '9769': { metricKey: 'US.PERSONAL_INCOME.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月个人收入(月率) | 10月个人收入(月率)
  '9770': { metricKey: 'US.PERSONAL_CONSUMPTION_EXPENDITURE.NONE.MOM', periodRule: 'month' },  // 3 行 · 8月个人消费支出(月率) | 9月个人消费支出(月率)
  '9801': { metricKey: 'US.EMPIRE_STATE_MANUFACTURING.PRICES_RECEIVED.SA.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月纽约联储制造业物价获得指数 | 11月纽约联储制造业物价获得指数
  '9802': { metricKey: 'US.LABOR_COST.NONE.QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度劳工成本指数(季率)
  '9829': { metricKey: 'US.DALLAS_FED_MANUFACTURING.SA.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月达拉斯联储制造业指数 | 11月达拉斯联储制造业指数
  '9843': { metricKey: 'US.EXPORTS_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月出口物价指数(年率) | 10月出口物价指数(年率)
  '9846': { metricKey: 'US.CAPACITY_UTILIZATION.MANUFACTURING.SA.RATE', periodRule: 'month' },  // 2 行 · 9月制造业产能利用率 | 10月制造业产能利用率
  '9847': { metricKey: 'US.MANUFACTURING_OUTPUT.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月制造业产出(月率) | 10月制造业产出(月率)
  '9874': { metricKey: 'US.FHFA_HOUSE_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 8月FHFA房价指数(月率) | 9月FHFA房价指数(月率)
  '9875': { metricKey: 'US.FHFA_HOUSE_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 8月FHFA房价指数(年率) | 9月FHFA房价指数(年率)
  '9925': { metricKey: 'US.REAL_GDP.NONE.ANNUALIZED_QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度实际GDP初值(年化季率)
  '9926': { metricKey: 'US.REAL_GDP.NONE.ANNUALIZED_QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度实际GDP修正值(年化季率)
  '9928': { metricKey: 'US.ANNUM_REAL_GDP.NONE.AMOUNT', periodRule: 'quarter' },  // 1 行 · 第三季度年化实际GDP(十亿美元)初值
  '9929': { metricKey: 'US.SALES.NONE.ANNUALIZED_QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度最终销售初值(年化季率)
  '9930': { metricKey: 'US.CORPORATE_PROFIT.NONE.ANNUALIZED_QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度企业获利初值(年化季率)
  '9931': { metricKey: 'US.ANNUM_REAL_GDP.NONE.AMOUNT', periodRule: 'quarter' },  // 1 行 · 第三季度年化实际GDP(十亿美元)修正值
  '9932': { metricKey: 'US.SALES.NONE.ANNUALIZED_QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度最终销售修正值(年化季率)
  '9933': { metricKey: 'US.CORPORATE_PROFIT.NONE.ANNUALIZED_QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度企业获利修正值(年化季率)
  '9937': { metricKey: 'US.TOTAL_NUMBER_CONSTRUCTION_PERMITS.NONE.COUNT', periodRule: 'month' },  // 2 行 · 9月营建许可总数初值(千户) | 10月营建许可总数初值(千户)
  '9942': { metricKey: 'US.MICHIGAN_SENTIMENT.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月密歇根大学消费者信心指数终值 | 11月密歇根大学消费者信心指数终值
})
