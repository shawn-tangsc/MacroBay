import type { ZeroXRouterPeriodRule } from '../marketCalendarMetricIdentity'

/**
 * 按国家拆开的「源内 id → 码」映射（JP）。**数据型注册表，纯声明**：一行一个源内身份。
 *
 * 只收期次可定、测度一致的映射；目标码必须存在于码表（守卫在索引里断）。
 */
export const mapping_JP: Readonly<Record<string, Readonly<{ metricKey: string; periodRule: ZeroXRouterPeriodRule }>>> = Object.freeze({
  '4261': { metricKey: 'JP.PURCHASED_FOREIGN_STOCKS_WEEK.NONE.AMOUNT', periodRule: 'week_end' },
  '4263': { metricKey: 'JP.PURCHASED_FOREIGN_BONDS_WEEK.NONE.AMOUNT', periodRule: 'week_end' },
  '4266': { metricKey: 'JP.FOREIGN_INVESTORS_BOUGHT_JAPAN_STOCKS_DAY.NONE.AMOUNT', periodRule: 'week_end' },
  '4269': { metricKey: 'JP.WEEK_FOREIGN_INVESTORS_BOUGHT_DAY_BONDS.NONE.AMOUNT', periodRule: 'week_end' },
  '206580': { metricKey: 'JP.INVENTORY.NONE.MOM', periodRule: 'month' },
  '212244': { metricKey: 'JP.ALL_HOUSEHOLD_EXPENDITURES.NONE.MOM', periodRule: 'month' },
  '212260': { metricKey: 'JP.LEADING_METRIC.NONE.MOM', periodRule: 'month' },
  '213340': { metricKey: 'JP.COINCIDENT_INDEX.NONE.MOM', periodRule: 'month' },
  '213613': { metricKey: 'JP.SP_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '213643': { metricKey: 'JP.TALENT_SEARCH_RATIO.NONE.LEVEL', periodRule: 'month' },
  '213644': { metricKey: 'JP.TOKYO_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '213646': { metricKey: 'JP.TOKYO_CORE_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '213648': { metricKey: 'JP.BASE_CURRENCY.NONE.YOY', periodRule: 'month' },
  '213707': { metricKey: 'JP.CABINET_OFFICE_CONSUMER_CONFIDENCE.NONE.COUNT', periodRule: 'month' },
  '213756': { metricKey: 'JP.LABOR_CASH_INCOME.NONE.YOY', periodRule: 'month' },
  '213757': { metricKey: 'JP.OVERTIME_PAY.NONE.YOY', periodRule: 'month' },
  '213758': { metricKey: 'JP.COINCIDENT_INDEX.NONE.LEVEL', periodRule: 'month' },
  '213759': { metricKey: 'JP.SYNCHRONOUS_METRIC.NONE.MOM', periodRule: 'month' },
  '213761': { metricKey: 'JP.LEADING_METRIC.NONE.MOM', periodRule: 'month' },
  '213781': { metricKey: 'JP.CURRENT_ACCOUNT.NSA.LEVEL', periodRule: 'month' },
  '213798': { metricKey: 'JP.ALL_HOUSEHOLD_EXPENDITURES.NONE.YOY', periodRule: 'month' },
  '213799': { metricKey: 'JP.ALL_HOUSEHOLD_EXPENDITURES.NONE.MOM', periodRule: 'month' },
  '213838': { metricKey: 'JP.BANK_LOANS.SA.YOY', periodRule: 'month' },
  '213839': { metricKey: 'JP.DOMESTIC_CORPORATE_COMMODITY_PRICE.NONE.MOM', periodRule: 'month' },
  '213840': { metricKey: 'JP.DOMESTIC_CORPORATE_COMMODITY_PRICE.NONE.YOY', periodRule: 'month' },
  '213852': { metricKey: 'JP.MONEY_SUPPLY_M2_CD.NONE.YOY', periodRule: 'month' },
  '213853': { metricKey: 'JP.BROAD_MONEY_FLOW.NONE.YOY', periodRule: 'month' },
  '213883': { metricKey: 'JP.CORE_MACHINERY_ORDERS.NONE.MOM', periodRule: 'month' },
  '213884': { metricKey: 'JP.CORE_MACHINERY_ORDERS.NONE.YOY', periodRule: 'month' },
  '213893': { metricKey: 'JP.EQUIPMENT_EXPLOITATION.NONE.MOM', periodRule: 'month' },
  '213895': { metricKey: 'JP.INDUSTRIAL_OUTPUT.NONE.MOM', periodRule: 'month' },
  '213896': { metricKey: 'JP.INDUSTRIAL_OUTPUT.NONE.YOY', periodRule: 'month' },
  '214035': { metricKey: 'JP.TERTIARY_INDUSTRY_ACTIVITY.NONE.MOM', periodRule: 'month' },
  '214069': { metricKey: 'JP.MERCHANDISE_EXPORTS.NONE.YOY', periodRule: 'month' },
  '214070': { metricKey: 'JP.MERCHANDISE_IMPORTS.NONE.YOY', periodRule: 'month' },
  '214122': { metricKey: 'JP.NATIONAL_CORE_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214123': { metricKey: 'JP.NATIONAL_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214124': { metricKey: 'JP.NATIONAL_CONSUMER_PRICE.NONE.LEVEL', periodRule: 'month' },
  '214125': { metricKey: 'JP.SP_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '214164': { metricKey: 'JP.ECONOMIC_OBSERVER_CURRENT_ECONOMIC.NONE.COUNT', periodRule: 'month' },
  '214165': { metricKey: 'JP.ECONOMIC_OBSERVER_ECONOMIC_OUTLOOK.NONE.COUNT', periodRule: 'month' },
  '214213': { metricKey: 'JP.BUSINESS_SERVICES_PRICE.NONE.YOY', periodRule: 'month' },
  '214214': { metricKey: 'JP.CORPORATE_SERVICE_PRICE.NONE.MOM', periodRule: 'month' },
  '214263': { metricKey: 'JP.CABINET_OFFICE_CONSUMER_CONFIDENCE.NONE.COUNT', periodRule: 'month' },
  '214296': { metricKey: 'JP.TALENT_SEARCH_RATIO.NONE.LEVEL', periodRule: 'month' },
  '214297': { metricKey: 'JP.TOKYO_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214299': { metricKey: 'JP.TOKYO_CORE_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214301': { metricKey: 'JP.INDUSTRIAL_OUTPUT.NONE.MOM', periodRule: 'month' },
  '214302': { metricKey: 'JP.INDUSTRIAL_OUTPUT.NONE.YOY', periodRule: 'month' },
  '214303': { metricKey: 'JP.RETAIL_SALES.NONE.YOY', periodRule: 'month' },
  '214305': { metricKey: 'JP.RETAIL_SALES.SA.MOM', periodRule: 'month' },
  '214310': { metricKey: 'JP.CONSTRUCTION_ORDERS.NONE.YOY', periodRule: 'month' },
  '214311': { metricKey: 'JP.HOUSING_STARTS.SA.COUNT', periodRule: 'month' },
  '214312': { metricKey: 'JP.NEW_HOUSING_STARTS.NONE.YOY', periodRule: 'month' },
  '214424': { metricKey: 'JP.BASE_CURRENCY.NONE.YOY', periodRule: 'month' },
  '214458': { metricKey: 'JP.SP_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '214484': { metricKey: 'JP.LABOR_CASH_INCOME.NONE.YOY', periodRule: 'month' },
  '214485': { metricKey: 'JP.OVERTIME_PAY.NONE.YOY', periodRule: 'month' },
  '214486': { metricKey: 'JP.PURCHASED_FOREIGN_BONDS_WEEK.NONE.AMOUNT', periodRule: 'week_end' },
  '214487': { metricKey: 'JP.PURCHASED_FOREIGN_STOCKS_WEEK.NONE.AMOUNT', periodRule: 'week_end' },
  '214488': { metricKey: 'JP.WEEK_FOREIGN_INVESTORS_BOUGHT_DAY_BONDS.NONE.AMOUNT', periodRule: 'month' },
  '214489': { metricKey: 'JP.FOREIGN_INVESTORS_BOUGHT_JAPAN_STOCKS_DAY.NONE.AMOUNT', periodRule: 'month' },
  '214544': { metricKey: 'JP.COINCIDENT_INDEX.NONE.LEVEL', periodRule: 'month' },
  '214545': { metricKey: 'JP.SYNCHRONOUS_METRIC.NONE.MOM', periodRule: 'month' },
  '214547': { metricKey: 'JP.LEADING_METRIC.NONE.MOM', periodRule: 'month' },
  '214558': { metricKey: 'JP.ALL_HOUSEHOLD_EXPENDITURES.NONE.YOY', periodRule: 'month' },
  '214559': { metricKey: 'JP.ALL_HOUSEHOLD_EXPENDITURES.NONE.MOM', periodRule: 'month' },
  '214562': { metricKey: 'JP.BANK_LOANS.SA.YOY', periodRule: 'month' },
  '214563': { metricKey: 'JP.CURRENT_ACCOUNT.NSA.LEVEL', periodRule: 'month' },
  '214592': { metricKey: 'JP.MONEY_SUPPLY_M2_CD.NONE.YOY', periodRule: 'month' },
  '214593': { metricKey: 'JP.BROAD_MONEY_FLOW.NONE.YOY', periodRule: 'month' },
  '214604': { metricKey: 'JP.DOMESTIC_CORPORATE_COMMODITY_PRICE.NONE.MOM', periodRule: 'month' },
  '214605': { metricKey: 'JP.DOMESTIC_CORPORATE_COMMODITY_PRICE.NONE.YOY', periodRule: 'month' },
  '214695': { metricKey: 'JP.SYNCHRONOUS_METRIC.NONE.MOM', periodRule: 'month' },
  '214696': { metricKey: 'JP.COINCIDENT_INDEX.NONE.LEVEL', periodRule: 'month' },
  '214698': { metricKey: 'JP.LEADING_METRIC.NONE.MOM', periodRule: 'month' },
  '214760': { metricKey: 'JP.REAL_GDP.NONE.QOQ', periodRule: 'quarter' },
  '214761': { metricKey: 'JP.REAL_GDP.NONE.ANNUALIZED_QOQ', periodRule: 'quarter' },
  '214762': { metricKey: 'JP.GDP_DEFLATOR.NONE.YOY', periodRule: 'month' },
  '214764': { metricKey: 'JP.NOMINAL_GDP.NONE.QOQ', periodRule: 'quarter' },
  '214765': { metricKey: 'JP.STARTING_VALUE_NOMINAL_GDP_ANNUM.NONE.AMOUNT', periodRule: 'month' },
  '214775': { metricKey: 'JP.INDUSTRIAL_OUTPUT.NONE.YOY', periodRule: 'month' },
  '214779': { metricKey: 'JP.INDUSTRIAL_OUTPUT.NONE.MOM', periodRule: 'month' },
  '214781': { metricKey: 'JP.EQUIPMENT_EXPLOITATION.NONE.MOM', periodRule: 'month' },
  '214799': { metricKey: 'JP.TERTIARY_INDUSTRY_ACTIVITY.NONE.MOM', periodRule: 'month' },
  '214835': { metricKey: 'JP.MERCHANDISE_EXPORTS.NONE.YOY', periodRule: 'month' },
  '214836': { metricKey: 'JP.MERCHANDISE_IMPORTS.NONE.YOY', periodRule: 'month' },
  '214878': { metricKey: 'JP.CORE_MACHINERY_ORDERS.NONE.MOM', periodRule: 'month' },
  '214879': { metricKey: 'JP.CORE_MACHINERY_ORDERS.NONE.YOY', periodRule: 'month' },
  '214919': { metricKey: 'JP.NATIONAL_CORE_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214920': { metricKey: 'JP.NATIONAL_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214921': { metricKey: 'JP.NATIONAL_CONSUMER_PRICE.NONE.LEVEL', periodRule: 'month' },
  '214952': { metricKey: 'JP.SP_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '214997': { metricKey: 'JP.BUSINESS_SERVICES_PRICE.NONE.YOY', periodRule: 'month' },
  '214998': { metricKey: 'JP.CORPORATE_SERVICE_PRICE.NONE.MOM', periodRule: 'month' },
  '215033': { metricKey: 'JP.COINCIDENT_INDEX.NONE.LEVEL', periodRule: 'month' },
  '215034': { metricKey: 'JP.SYNCHRONOUS_METRIC.NONE.MOM', periodRule: 'month' },
  '215036': { metricKey: 'JP.LEADING_METRIC.NONE.MOM', periodRule: 'month' },
  '215047': { metricKey: 'JP.TOKYO_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '215049': { metricKey: 'JP.TOKYO_CORE_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '10051': { metricKey: 'JP.NOMINAL_GDP.NONE.QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度名义GDP初值(季率)
  '10054': { metricKey: 'JP.STARTING_VALUE_NOMINAL_GDP_ANNUM.NONE.AMOUNT', periodRule: 'quarter' },  // 1 行 · 第三季度名义GDP年化初值(十亿日元)
  '10057': { metricKey: 'JP.REAL_GDP.NONE.QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度实际GDP初值(季率)
  '10060': { metricKey: 'JP.REAL_GDP.NONE.AMOUNT', periodRule: 'quarter' },  // 1 行 · 第三季度实际GDP初值(十亿日元)
  '10063': { metricKey: 'JP.GDP_DEFLATOR.NONE.YOY', periodRule: 'quarter' },  // 1 行 · 第三季度GDP平减指数初值(年率)
  '10171': { metricKey: 'JP.INDUSTRIAL_OUTPUT.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月工业产出初值(年率) | 10月工业产出初值(年率)
  '10172': { metricKey: 'JP.INDUSTRIAL_OUTPUT.NONE.YOY', periodRule: 'month' },  // 1 行 · 8月工业产出修正值(年率)
  '10173': { metricKey: 'JP.INDUSTRIAL_OUTPUT.NONE.YOY', periodRule: 'month' },  // 1 行 · 9月工业产出终值(年率)
  '10174': { metricKey: 'JP.INDUSTRIAL_OUTPUT.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月工业产出初值(月率) | 10月工业产出初值(月率)
  '10175': { metricKey: 'JP.INDUSTRIAL_OUTPUT.NONE.MOM', periodRule: 'month' },  // 1 行 · 8月工业产出修正值(月率)
  '10176': { metricKey: 'JP.INDUSTRIAL_OUTPUT.NONE.MOM', periodRule: 'month' },  // 1 行 · 8月工业产出终值(月率)
  '10179': { metricKey: 'JP.INVENTORY.NONE.MOM', periodRule: 'month' },  // 1 行 · 9月库存终值(月率)
  '10195': { metricKey: 'JP.SP_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月制造业采购经理人指数初值 | 11月制造业采购经理人指数初值
  '10197': { metricKey: 'JP.SP_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 9月制造业采购经理人指数终值 | 10月制造业采购经理人指数终值
  '4038': { metricKey: 'JP.TOKYO_CONSUMER_PRICE.NONE.LEVEL', periodRule: 'month' },  // 3 行 · 9月东京消费者物价指数 | 10月东京消费者物价指数
  '4039': { metricKey: 'JP.NATIONAL_CONSUMER_PRICE.NONE.LEVEL', periodRule: 'month' },  // 2 行 · 9月全国消费者物价指数 | 10月全国消费者物价指数
  '4047': { metricKey: 'JP.CURRENT_ACCOUNT.SA.AMOUNT', periodRule: 'month' },  // 2 行 · 8月季调后经常帐(十亿日元) | 9月季调后经常帐(十亿日元)
  '4057': { metricKey: 'JP.UNEMPLOYMENT.NONE.RATE', periodRule: 'month' },  // 3 行 · 8月失业率 | 9月失业率
  '4063': { metricKey: 'JP.RETAIL_SALES.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 9月零售销售(十亿日元) | 10月零售销售(十亿日元)
  '8660': { metricKey: 'JP.NATIONAL_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月全国消费者物价指数(年率) | 10月全国消费者物价指数(年率)
  '8661': { metricKey: 'JP.NATIONAL_CORE_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月全国核心消费者物价指数(年率) | 10月全国核心消费者物价指数(年率)
  '9031': { metricKey: 'JP.ALL_HOUSEHOLD_EXPENDITURES.NONE.YOY', periodRule: 'month' },  // 2 行 · 8月所有家庭支出(年率) | 9月所有家庭支出(年率)
  '9032': { metricKey: 'JP.TALENT_SEARCH_RATIO.NONE.LEVEL', periodRule: 'month' },  // 3 行 · 8月求才求职比 | 9月求才求职比
  '9033': { metricKey: 'JP.RETAIL_SALES.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月零售销售(年率) | 10月零售销售(年率)
  '9037': { metricKey: 'JP.CURRENT_ACCOUNT.SA.AMOUNT', periodRule: 'month' },  // 2 行 · 8月未季调经常帐(十亿日元) | 9月未季调经常帐(十亿日元)
  '9039': { metricKey: 'JP.CONSTRUCTION_ORDERS.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月营建订单(年率) | 10月营建订单(年率)
  '9040': { metricKey: 'JP.MONEY_SUPPLY_M2_CD.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月货币供应M2+CD(年率) | 10月货币供应M2+CD(年率)
  '9041': { metricKey: 'JP.BROAD_MONEY_FLOW.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月广义货币流动(年率) | 10月广义货币流动(年率)
  '9081': { metricKey: 'JP.TOKYO_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },  // 3 行 · 9月东京消费者物价指数(年率) | 10月东京消费者物价指数(年率)
  '9082': { metricKey: 'JP.TOKYO_CORE_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },  // 3 行 · 9月东京核心消费者物价指数(年率) | 10月东京核心消费者物价指数(年率)
  '9267': { metricKey: 'JP.CORE_MACHINERY_ORDERS.NONE.YOY', periodRule: 'month' },  // 2 行 · 8月核心机械订单(年率) | 9月核心机械订单(年率)
  '9269': { metricKey: 'JP.CORE_MACHINERY_ORDERS.NONE.MOM', periodRule: 'month' },  // 2 行 · 8月核心机械订单(月率) | 9月核心机械订单(月率)
  '9271': { metricKey: 'JP.ALL_HOUSEHOLD_EXPENDITURES.NONE.MOM', periodRule: 'month' },  // 3 行 · All household expenditures (MoM)(Jun) | 8月所有
  '9287': { metricKey: 'JP.MERCHANDISE_EXPORTS.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月商品出口(年率)(海关) | 10月商品出口(年率)(海关)
  '9294': { metricKey: 'JP.MERCHANDISE_IMPORTS.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月商品进口(年率)(海关) | 10月商品进口(年率)(海关)
  '9412': { metricKey: 'JP.TANKAN_CAPEX.NONE.LEVEL', periodRule: 'quarter' },  // 1 行 · 第三季度短观大型制造业资本支出
  '9591': { metricKey: 'JP.BASE_CURRENCY.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月基础货币(年率) | 10月基础货币(年率)
  '9592': { metricKey: 'JP.FOREIGN_EXCHANGE_RESERVES.NONE.AMOUNT', periodRule: 'month' },  // 3 行 · 9月外汇储备(十亿美元) | 10月外汇储备(十亿美元)
  '9599': { metricKey: 'JP.BANK_LOANS.SA.YOY', periodRule: 'month' },  // 2 行 · 9月季调后银行贷款(年率) | 10月季调后银行贷款(年率)
  '9610': { metricKey: 'JP.EQUIPMENT_EXPLOITATION.NONE.MOM', periodRule: 'month' },  // 2 行 · 8月设备利用指数(月率) | 9月设备利用指数(月率)
  '9611': { metricKey: 'JP.EQUIPMENT_EXPLOITATION.NONE.LEVEL', periodRule: 'month' },  // 2 行 · 8月设备利用指数 | 9月设备利用指数
  '9613': { metricKey: 'JP.TERTIARY_INDUSTRY_ACTIVITY.NONE.MOM', periodRule: 'month' },  // 2 行 · 8月第三产业活动指数(月率) | 9月第三产业活动指数(月率)
  '9615': { metricKey: 'JP.BUSINESS_SERVICES_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月企业服务价格指数(年率) | 10月企业服务价格指数(年率)
  '9616': { metricKey: 'JP.CORPORATE_SERVICE_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月企业服务价格指数(月率) | 10月企业服务价格指数(月率)
  '9619': { metricKey: 'JP.NEW_HOUSING_STARTS.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月新屋开工(年率) | 10月新屋开工(年率)
  '9623': { metricKey: 'JP.OVERTIME_PAY.NONE.YOY', periodRule: 'month' },  // 2 行 · 8月加班工资(年率) | 9月加班工资(年率)
  '9624': { metricKey: 'JP.LABOR_CASH_INCOME.NONE.YOY', periodRule: 'month' },  // 2 行 · 8月劳动现金收入(年率) | 9月劳动现金收入(年率)
  '9792': { metricKey: 'JP.DOMESTIC_CORPORATE_COMMODITY_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月国内企业商品物价指数(月率) | 10月国内企业商品物价指数(月率)
  '9794': { metricKey: 'JP.DOMESTIC_CORPORATE_COMMODITY_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月国内企业商品物价指数(年率) | 10月国内企业商品物价指数(年率)
  '9799': { metricKey: 'JP.RETAIL_SALES.SA.MOM', periodRule: 'month' },  // 2 行 · 9月季调后零售销售(月率) | 10月季调后零售销售(月率)
  '9808': { metricKey: 'JP.MERCHANDISE_TRADE_ACCOUNT.SA.AMOUNT', periodRule: 'month' },  // 2 行 · 9月季调后商品贸易帐(十亿日元)(海关) | 10月季调后商品贸易帐(十亿日元)(海关)
  '9848': { metricKey: 'JP.UNSEASONALLY_MERCHANDISE_TRADE_ACCOUNT.NSA.AMOUNT', periodRule: 'month' },  // 2 行 · 9月未季调商品贸易帐(十亿日元)(海关) | 10月未季调商品贸易帐(十亿日元)(海关)
  '9946': { metricKey: 'JP.LEADING_METRIC.NONE.MOM', periodRule: 'month' },  // 2 行 · 8月领先指标初值 | 9月领先指标初值
  '9947': { metricKey: 'JP.LEADING_METRIC.NONE.MOM', periodRule: 'month' },  // 1 行 · 9月领先指标修正值
  '9948': { metricKey: 'JP.LEADING_METRIC.NONE.MOM', periodRule: 'month' },  // 1 行 · 8月领先指标终值
  '9949': { metricKey: 'JP.LEADING_METRIC.NONE.MOM', periodRule: 'month' },  // 3 行 · Leading Metric (MoM)(Preliminary)(Jun) | 8月领
  '9950': { metricKey: 'JP.LEADING_METRIC.NONE.MOM', periodRule: 'month' },  // 1 行 · 9月领先指标修正值(月率)
  '9951': { metricKey: 'JP.LEADING_METRIC.NONE.MOM', periodRule: 'month' },  // 1 行 · 8月领先指标终值(月率)
  '9952': { metricKey: 'JP.COINCIDENT_INDEX.NONE.MOM', periodRule: 'month' },  // 2 行 · 8月同步指标初值 | 9月同步指标初值
  '9953': { metricKey: 'JP.COINCIDENT_INDEX.NONE.MOM', periodRule: 'month' },  // 1 行 · 9月同步指标修正值
  '9954': { metricKey: 'JP.COINCIDENT_INDEX.NONE.MOM', periodRule: 'month' },  // 1 行 · 8月同步指标终值
  '9955': { metricKey: 'JP.COINCIDENT_INDEX.NONE.MOM', periodRule: 'month' },  // 2 行 · 8月同步指标初值(月率) | 9月同步指标初值(月率)
  '9956': { metricKey: 'JP.COINCIDENT_INDEX.NONE.MOM', periodRule: 'month' },  // 1 行 · 9月同步指标修正值(月率)
  '9957': { metricKey: 'JP.COINCIDENT_INDEX.NONE.MOM', periodRule: 'month' },  // 2 行 · 6月同步指标终值(月率) | 8月同步指标终值(月率)
  '9958': { metricKey: 'JP.REAL_GDP.NONE.ANNUALIZED_QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度实际GDP初值(年化季率)
})
