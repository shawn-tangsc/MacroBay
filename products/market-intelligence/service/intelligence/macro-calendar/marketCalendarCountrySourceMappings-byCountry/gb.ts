import type { ZeroXRouterPeriodRule } from '../marketCalendarMetricIdentity'

/**
 * 按国家拆开的「源内 id → 码」映射（GB）。**数据型注册表，纯声明**：一行一个源内身份。
 *
 * 只收期次可定、测度一致的映射；目标码必须存在于码表（守卫在索引里断）。
 */
export const mapping_GB: Readonly<Record<string, Readonly<{ metricKey: string; periodRule: ZeroXRouterPeriodRule }>>> = Object.freeze({
  '212372': { metricKey: 'GB.TOTAL_BUSINESS_INVESTMENT.NONE.YOY', periodRule: 'month' },
  '212376': { metricKey: 'GB.GDP.NONE.YOY', periodRule: 'month' },
  '212378': { metricKey: 'GB.INDUSTRIAL_OUTPUT.NONE.YOY', periodRule: 'month' },
  '212380': { metricKey: 'GB.MANUFACTURING_OUTPUT.NONE.YOY', periodRule: 'month' },
  '212525': { metricKey: 'GB.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '213556': { metricKey: 'GB.NATIONWIDE_HOUSE_PRICE.NONE.MOM', periodRule: 'month' },
  '213557': { metricKey: 'GB.NATIONWIDE_HOUSE_PRICE.NONE.YOY', periodRule: 'month' },
  '213626': { metricKey: 'GB.CIPS_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '213719': { metricKey: 'GB.CIPS_SERVICES_PMI.NONE.LEVEL', periodRule: 'month' },
  '213742': { metricKey: 'GB.CIPS_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '213764': { metricKey: 'GB.HALIFAX_HOUSE_PRICE.SA.YOY', periodRule: 'month' },
  '213765': { metricKey: 'GB.HALIFAX_HOUSE_PRICE.SA.MOM', periodRule: 'month' },
  '213780': { metricKey: 'GB.RICS_HOUSE_PRICE.NONE.LEVEL', periodRule: 'month' },
  '213836': { metricKey: 'GB.BRC_SAME_STORE_RETAIL_SALES.NONE.YOY', periodRule: 'month' },
  '213837': { metricKey: 'GB.BRC_OVERALL_RETAIL_SALES.NONE.YOY', periodRule: 'month' },
  '213897': { metricKey: 'GB.NIESR_THREE_MONTH_GDP_ESTIMATE.NONE.YOY', periodRule: 'month' },
  '213898': { metricKey: 'GB.GDP.NONE.MOM', periodRule: 'month' },
  '213899': { metricKey: 'GB.INDUSTRIAL_OUTPUT.NONE.MOM', periodRule: 'month' },
  '213900': { metricKey: 'GB.INDUSTRIAL_OUTPUT.NONE.YOY', periodRule: 'month' },
  '213901': { metricKey: 'GB.MANUFACTURING_OUTPUT.NONE.MOM', periodRule: 'month' },
  '213902': { metricKey: 'GB.MANUFACTURING_OUTPUT.NONE.YOY', periodRule: 'month' },
  '213904': { metricKey: 'GB.TRADE_ACCOUNT_EU.NONE.AMOUNT', periodRule: 'month' },
  '213968': { metricKey: 'GB.CBI_INDUSTRIAL_ORDERS_EXPECTED_DIFFERENCE.NONE.LEVEL', periodRule: 'month' },
  '213969': { metricKey: 'GB.CBI_INDUSTRIAL_OUTPUT_EXPECTED_DIFFERENCE.NONE.LEVEL', periodRule: 'month' },
  '214025': { metricKey: 'GB.RIGHTMOVE_AVERAGE_HOUSE_ASKING_PRICE.NONE.MOM', periodRule: 'month' },
  '214026': { metricKey: 'GB.RIGHTMOVE_AVERAGE_HOME_PRICE.NONE.YOY', periodRule: 'month' },
  '214036': { metricKey: 'GB.CBI_RETAIL_SALES_DIFFERENCE.NONE.LEVEL', periodRule: 'month' },
  '214037': { metricKey: 'GB.CBI_RETAIL_SALES_EXPECTATION.NONE.LEVEL', periodRule: 'month' },
  '214043': { metricKey: 'GB.THREE_MONTH_AVERAGE_TOTAL_PAY_INCLUDING_BONUSES.NONE.YOY', periodRule: 'month' },
  '214044': { metricKey: 'GB.THREE_MONTH_AVERAGE_REGULAR_PAY_EXCLUDING_BONUSES.NONE.YOY', periodRule: 'month' },
  '214047': { metricKey: 'GB.TRANSMUTATION_NUMBER_UNEMPLOYMENT_K_APPLICATIONS.NONE.COUNT', periodRule: 'month' },
  '214071': { metricKey: 'GB.CORE_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214072': { metricKey: 'GB.CORE_CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '214073': { metricKey: 'GB.PRODUCER_OUTPUT_PRICE.NSA.MOM', periodRule: 'month' },
  '214074': { metricKey: 'GB.PRODUCER_OUTPUT_PRICE.NSA.YOY', periodRule: 'month' },
  '214075': { metricKey: 'GB.PRODUCER_INPUT_PRICE.NSA.MOM', periodRule: 'month' },
  '214076': { metricKey: 'GB.PRODUCER_INPUT_PRICE.NSA.YOY', periodRule: 'month' },
  '214077': { metricKey: 'GB.CORE_PRODUCER_OUTPUT_PRICE_NOT.NSA.YOY', periodRule: 'month' },
  '214078': { metricKey: 'GB.SHORT_BALANCE_GOVERNMENT_REVENUE_EXPENDITURE.NONE.AMOUNT', periodRule: 'month' },
  '214079': { metricKey: 'GB.PUBLIC_DEPARTMENT_NET_BORROWING.NONE.AMOUNT', periodRule: 'month' },
  '214080': { metricKey: 'GB.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '214081': { metricKey: 'GB.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214082': { metricKey: 'GB.RETAIL_PRICE.NONE.MOM', periodRule: 'month' },
  '214083': { metricKey: 'GB.CORE_RETAIL_PRICE.NONE.YOY', periodRule: 'month' },
  '214084': { metricKey: 'GB.CORE_RETAIL_PRICE.NONE.MOM', periodRule: 'month' },
  '214085': { metricKey: 'GB.RETAIL_PRICE.NONE.YOY', periodRule: 'month' },
  '214121': { metricKey: 'GB.GFK_CONSUMER_CONFIDENCE.NONE.LEVEL', periodRule: 'month' },
  '214127': { metricKey: 'GB.CORE_RETAIL_SALES.SA.MOM', periodRule: 'month' },
  '214128': { metricKey: 'GB.CORE_RETAIL_SALES.SA.YOY', periodRule: 'month' },
  '214129': { metricKey: 'GB.RETAIL_SALES.SA.MOM', periodRule: 'month' },
  '214130': { metricKey: 'GB.RETAIL_SALES.SA.YOY', periodRule: 'month' },
  '214143': { metricKey: 'GB.CIPS_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '214144': { metricKey: 'GB.CIPS_SERVICES_PMI.NONE.LEVEL', periodRule: 'month' },
  '214265': { metricKey: 'GB.CONSUMER_CREDIT.NONE.AMOUNT', periodRule: 'month' },
  '214266': { metricKey: 'GB.M4_MONEY_SUPPLY.NONE.MOM', periodRule: 'month' },
  '214267': { metricKey: 'GB.M4_MONEY_SUPPLY.NONE.YOY', periodRule: 'month' },
  '214268': { metricKey: 'GB.CENTRAL_BANK_MORTGAGE_CHANGES.NONE.AMOUNT', periodRule: 'month' },
  '214269': { metricKey: 'GB.CENTRAL_BANK_MORTGAGE_LOAN_LICENSES.NONE.COUNT', periodRule: 'month' },
  '214319': { metricKey: 'GB.NATIONWIDE_HOUSE_PRICE.NONE.MOM', periodRule: 'month' },
  '214320': { metricKey: 'GB.NATIONWIDE_HOUSE_PRICE.NONE.YOY', periodRule: 'month' },
  '214388': { metricKey: 'GB.CIPS_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '214434': { metricKey: 'GB.CIPS_SERVICES_PMI.NONE.LEVEL', periodRule: 'month' },
  '214475': { metricKey: 'GB.CIPS_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '214494': { metricKey: 'GB.HALIFAX_HOUSE_PRICE.SA.YOY', periodRule: 'month' },
  '214495': { metricKey: 'GB.HALIFAX_HOUSE_PRICE.SA.MOM', periodRule: 'month' },
  '214565': { metricKey: 'GB.BRC_SAME_STORE_RETAIL_SALES.NONE.YOY', periodRule: 'month' },
  '214566': { metricKey: 'GB.BRC_OVERALL_RETAIL_SALES.NONE.YOY', periodRule: 'month' },
  '214612': { metricKey: 'GB.TOTAL_BUSINESS_INVESTMENT.NONE.YOY', periodRule: 'month' },
  '214613': { metricKey: 'GB.NIESR_THREE_MONTH_GDP_ESTIMATE.NONE.YOY', periodRule: 'month' },
  '214614': { metricKey: 'GB.GDP.NONE.MOM', periodRule: 'month' },
  '214615': { metricKey: 'GB.GDP.NONE.QOQ', periodRule: 'quarter' },
  '214616': { metricKey: 'GB.GDP.NONE.YOY', periodRule: 'month' },
  '214617': { metricKey: 'GB.INDUSTRIAL_OUTPUT.NONE.MOM', periodRule: 'month' },
  '214618': { metricKey: 'GB.INDUSTRIAL_OUTPUT.NONE.YOY', periodRule: 'month' },
  '214619': { metricKey: 'GB.MANUFACTURING_OUTPUT.NONE.MOM', periodRule: 'month' },
  '214620': { metricKey: 'GB.MANUFACTURING_OUTPUT.NONE.YOY', periodRule: 'month' },
  '214622': { metricKey: 'GB.TRADE_ACCOUNT_EU.NONE.AMOUNT', periodRule: 'month' },
  '214758': { metricKey: 'GB.RIGHTMOVE_AVERAGE_HOUSE_ASKING_PRICE.NONE.MOM', periodRule: 'month' },
  '214759': { metricKey: 'GB.RIGHTMOVE_AVERAGE_HOME_PRICE.NONE.YOY', periodRule: 'month' },
  '214800': { metricKey: 'GB.THREE_MONTH_AVERAGE_TOTAL_PAY_INCLUDING_BONUSES.NONE.YOY', periodRule: 'month' },
  '214801': { metricKey: 'GB.THREE_MONTH_AVERAGE_REGULAR_PAY_EXCLUDING_BONUSES.NONE.YOY', periodRule: 'month' },
  '214802': { metricKey: 'GB.THREE_MONTH_CHANGE_ILO_UNEMPLOYMENT.NONE.COUNT', periodRule: 'month' },
  '214803': { metricKey: 'GB.THREE_MONTH_AVERAGE_ILO_UNEMPLOYMENT.NONE.RATE', periodRule: 'month' },
  '214804': { metricKey: 'GB.TRANSMUTATION_NUMBER_UNEMPLOYMENT_K_APPLICATIONS.NONE.COUNT', periodRule: 'month' },
  '214840': { metricKey: 'GB.CORE_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214841': { metricKey: 'GB.CORE_CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '214842': { metricKey: 'GB.PRODUCER_OUTPUT_PRICE.NSA.MOM', periodRule: 'month' },
  '214843': { metricKey: 'GB.PRODUCER_OUTPUT_PRICE.NSA.YOY', periodRule: 'month' },
  '214844': { metricKey: 'GB.PRODUCER_INPUT_PRICE.NSA.MOM', periodRule: 'month' },
  '214845': { metricKey: 'GB.PRODUCER_INPUT_PRICE.NSA.YOY', periodRule: 'month' },
  '214846': { metricKey: 'GB.CORE_PRODUCER_OUTPUT_PRICE_NOT.NSA.YOY', periodRule: 'month' },
  '214847': { metricKey: 'GB.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '214848': { metricKey: 'GB.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214849': { metricKey: 'GB.RETAIL_PRICE.NONE.MOM', periodRule: 'month' },
  '214850': { metricKey: 'GB.CORE_RETAIL_PRICE.NONE.YOY', periodRule: 'month' },
  '214851': { metricKey: 'GB.CORE_RETAIL_PRICE.NONE.MOM', periodRule: 'month' },
  '214852': { metricKey: 'GB.RETAIL_PRICE.NONE.YOY', periodRule: 'month' },
  '214853': { metricKey: 'GB.DCLG_HOUSE_PRICE.NONE.YOY', periodRule: 'month' },
  '214922': { metricKey: 'GB.GFK_CONSUMER_CONFIDENCE.NONE.LEVEL', periodRule: 'month' },
  '214927': { metricKey: 'GB.SHORT_BALANCE_GOVERNMENT_REVENUE_EXPENDITURE.NONE.AMOUNT', periodRule: 'month' },
  '214928': { metricKey: 'GB.PUBLIC_DEPARTMENT_NET_BORROWING.NONE.AMOUNT', periodRule: 'month' },
  '214929': { metricKey: 'GB.CORE_RETAIL_SALES.SA.MOM', periodRule: 'month' },
  '214930': { metricKey: 'GB.CORE_RETAIL_SALES.SA.YOY', periodRule: 'month' },
  '214931': { metricKey: 'GB.RETAIL_SALES.SA.MOM', periodRule: 'month' },
  '214932': { metricKey: 'GB.RETAIL_SALES.SA.YOY', periodRule: 'month' },
  '214969': { metricKey: 'GB.CIPS_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '214970': { metricKey: 'GB.CIPS_SERVICES_PMI.NONE.LEVEL', periodRule: 'month' },
  '215045': { metricKey: 'GB.CBI_RETAIL_SALES_DIFFERENCE.NONE.LEVEL', periodRule: 'month' },
  '215046': { metricKey: 'GB.CBI_RETAIL_SALES_EXPECTATION.NONE.LEVEL', periodRule: 'month' },
  '215402': { metricKey: 'GB.CBI_INDUSTRIAL_ORDERS_EXPECTED_DIFFERENCE.NONE.LEVEL', periodRule: 'month' },
  '215403': { metricKey: 'GB.CBI_INDUSTRIAL_OUTPUT_EXPECTED_DIFFERENCE.NONE.LEVEL', periodRule: 'month' },
  '10066': { metricKey: 'GB.GDP.NONE.QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度GDP初值(季率)
  '10069': { metricKey: 'GB.GDP.NONE.YOY', periodRule: 'quarter' },  // 2 行 · 第二季度GDP初值(年率) | 第三季度GDP初值(年率)
  '10138': { metricKey: 'GB.TOTAL_BUSINESS_INVESTMENT.NONE.YOY', periodRule: 'quarter' },  // 2 行 · Total business investment (YoY)(Preliminary)
  '4127': { metricKey: 'GB.UNEMPLOYMENT.NONE.RATE', periodRule: 'month' },  // 2 行 · 9月失业率 | 10月失业率
  '8801': { metricKey: 'GB.CBI_INDUSTRIAL_ORDERS_EXPECTED_DIFFERENCE.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月CBI工业订单预期差值 | 11月CBI工业订单预期差值
  '8802': { metricKey: 'GB.CBI_RETAIL_SALES_DIFFERENCE.NONE.LEVEL', periodRule: 'current_month' },  // 3 行 · CBI retail sales difference(Aug) | 10月CBI零售销
  '8803': { metricKey: 'GB.TRANSMUTATION_NUMBER_UNEMPLOYMENT_K_APPLICATIONS.NONE.COUNT', periodRule: 'month' },  // 2 行 · 9月失业金申请人数变化(千人) | 10月失业金申请人数变化(千人)
  '8804': { metricKey: 'GB.THREE_MONTH_AVERAGE_ILO_UNEMPLOYMENT.NONE.RATE', periodRule: 'month' },  // 2 行 · 至8月三个月ILO失业率 | 至9月三个月ILO失业率
  '8805': { metricKey: 'GB.THREE_MONTH_CHANGE_ILO_UNEMPLOYMENT.NONE.COUNT', periodRule: 'month' },  // 2 行 · 至8月三个月ILO失业人数变化(千人) | 至9月三个月ILO失业人数变化(千人)
  '8806': { metricKey: 'GB.THREE_MONTH_AVERAGE_TOTAL_PAY_INCLUDING_BONUSES.NONE.YOY', periodRule: 'month' },  // 2 行 · 至8月三个月包括红利的平均工资(年率) | 至9月三个月包括红利的平均工资(年率)
  '8807': { metricKey: 'GB.THREE_MONTH_AVERAGE_REGULAR_PAY_EXCLUDING_BONUSES.NONE.YOY', periodRule: 'month' },  // 2 行 · 至8月三个月不包括红利的平均工资(年率) | 至9月三个月不包括红利的平均工资(年率)
  '8808': { metricKey: 'GB.CORE_CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月核心消费者物价指数(月率) | 10月核心消费者物价指数(月率)
  '8814': { metricKey: 'GB.MERCHANDISE_TRADE_ACCOUNT.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 8月商品贸易帐(百万英镑) | 9月商品贸易帐(百万英镑)
  '9114': { metricKey: 'GB.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },  // 3 行 · Consumer Price Index (YoY)(Jul) | 9月消费者物价指数(
  '9115': { metricKey: 'GB.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月消费者物价指数(月率) | 10月消费者物价指数(月率)
  '9136': { metricKey: 'GB.RETAIL_SALES.SA.YOY', periodRule: 'month' },  // 2 行 · 9月季调后零售销售(年率) | 10月季调后零售销售(年率)
  '9137': { metricKey: 'GB.RETAIL_SALES.SA.MOM', periodRule: 'month' },  // 2 行 · 9月季调后零售销售(月率) | 10月季调后零售销售(月率)
  '9333': { metricKey: 'GB.INDUSTRIAL_OUTPUT.NONE.YOY', periodRule: 'month' },  // 3 行 · 6月工业产出(年率) | 8月工业产出(年率)
  '9334': { metricKey: 'GB.INDUSTRIAL_OUTPUT.NONE.MOM', periodRule: 'month' },  // 2 行 · 8月工业产出(月率) | 9月工业产出(月率)
  '9340': { metricKey: 'GB.MANUFACTURING_OUTPUT.NONE.YOY', periodRule: 'month' },  // 3 行 · 6月制造业产出(年率) | 8月制造业产出(年率)
  '9341': { metricKey: 'GB.MANUFACTURING_OUTPUT.NONE.MOM', periodRule: 'month' },  // 2 行 · 8月制造业产出(月率) | 9月制造业产出(月率)
  '9342': { metricKey: 'GB.TRADE_ACCOUNT_EU.NONE.LEVEL', periodRule: 'month' },  // 3 行 · 6月对欧盟贸易帐(亿英镑) | 8月对欧盟贸易帐(亿英镑)
  '9343': { metricKey: 'GB.TRADE_ACCOUNT_EU.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 8月对非欧盟贸易帐(百万英镑) | 9月对非欧盟贸易帐(百万英镑)
  '9344': { metricKey: 'GB.PRODUCER_INPUT_PRICE.NSA.YOY', periodRule: 'month' },  // 2 行 · 9月未季调生产者输入物价指数(年率) | 10月未季调生产者输入物价指数(年率)
  '9345': { metricKey: 'GB.PRODUCER_INPUT_PRICE.NSA.MOM', periodRule: 'month' },  // 2 行 · 9月未季调生产者输入物价指数(月率) | 10月未季调生产者输入物价指数(月率)
  '9350': { metricKey: 'GB.CORE_PRODUCER_OUTPUT_PRICE_NOT.NSA.YOY', periodRule: 'month' },  // 2 行 · 9月未季调核心生产者输出物价指数(年率) | 10月未季调核心生产者输出物价指数(年率)
  '9356': { metricKey: 'GB.PRODUCER_OUTPUT_PRICE.NSA.MOM', periodRule: 'month' },  // 2 行 · 9月未季调生产者输出物价指数(月率) | 10月未季调生产者输出物价指数(月率)
  '9358': { metricKey: 'GB.PRODUCER_OUTPUT_PRICE.NSA.YOY', periodRule: 'month' },  // 2 行 · 9月未季调生产者输出物价指数(年率) | 10月未季调生产者输出物价指数(年率)
  '9362': { metricKey: 'GB.CORE_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月核心消费者物价指数(年率) | 10月核心消费者物价指数(年率)
  '9363': { metricKey: 'GB.CORE_RETAIL_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月核心零售物价指数(年率) | 10月核心零售物价指数(年率)
  '9365': { metricKey: 'GB.RETAIL_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月零售物价指数(年率) | 10月零售物价指数(年率)
  '9366': { metricKey: 'GB.RETAIL_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月零售物价指数(月率) | 10月零售物价指数(月率)
  '9367': { metricKey: 'GB.CBI_RETAIL_SALES_EXPECTATION.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月CBI零售销售预期指数 | 11月CBI零售销售预期指数
  '9512': { metricKey: 'GB.MARKIT_CIPS_CONSTRUCTION_PURCHASING_MANAGERS.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 9月建筑业采购经理人指数 | 10月建筑业采购经理人指数
  '9514': { metricKey: 'GB.M4_MONEY_SUPPLY.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月M4货币供给(年率) | 10月M4货币供给(年率)
  '9515': { metricKey: 'GB.M4_MONEY_SUPPLY.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月M4货币供给(月率) | 10月M4货币供给(月率)
  '9516': { metricKey: 'GB.CONSUMER_CREDIT.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 9月消费信贷(十亿英镑) | 10月消费信贷(十亿英镑)
  '9517': { metricKey: 'GB.CENTRAL_BANK_MORTGAGE_CHANGES.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 9月央行抵押贷款变动(十亿英镑) | 10月央行抵押贷款变动(十亿英镑)
  '9518': { metricKey: 'GB.CENTRAL_BANK_MORTGAGE_LOAN_LICENSES.NONE.COUNT', periodRule: 'month' },  // 2 行 · 9月央行抵押贷款许可(千件) | 10月央行抵押贷款许可(千件)
  '9519': { metricKey: 'GB.HALIFAX_HOUSE_PRICE.SA.MOM', periodRule: 'month' },  // 2 行 · 9月Halifax季调后房价指数(月率) | 10月Halifax季调后房价指数(月率)
  '9520': { metricKey: 'GB.HALIFAX_HOUSE_PRICE.SA.YOY', periodRule: 'month' },  // 2 行 · 9月Halifax季调后房价指数(年率) | 10月Halifax季调后房价指数(年率)
  '9521': { metricKey: 'GB.BRC_SAME_STORE_RETAIL_SALES.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月BRC同店零售销售(年率) | 10月BRC同店零售销售(年率)
  '9522': { metricKey: 'GB.BRC_OVERALL_RETAIL_SALES.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月BRC总体零售销售(年率) | 10月BRC总体零售销售(年率)
  '9525': { metricKey: 'GB.NIESR_THREE_MONTH_GDP_ESTIMATE.NONE.YOY', periodRule: 'month' },  // 2 行 · NIESR至8月三个月GDP预估(年率) | NIESR至9月三个月GDP预估(年率)
  '9526': { metricKey: 'GB.RICS_HOUSE_PRICE.NONE.LEVEL', periodRule: 'month' },  // 2 行 · 至9月三个月RICS房价指数 | 至10月三个月RICS房价指数
  '9527': { metricKey: 'GB.DCLG_HOUSE_PRICE.NONE.YOY', periodRule: 'month' },  // 1 行 · 9月DCLG房价指数(年率)
  '9528': { metricKey: 'GB.RIGHTMOVE_AVERAGE_HOUSE_ASKING_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 10月Rightmove平均房屋要价指数(月率) | 11月Rightmove平均房屋要
  '9529': { metricKey: 'GB.RIGHTMOVE_AVERAGE_HOME_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 10月Rightmove平均房屋要价指数(年率) | 11月Rightmove平均房屋要
  '9530': { metricKey: 'GB.CBI_INDUSTRIAL_OUTPUT_EXPECTED_DIFFERENCE.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月CBI工业产出预期差值 | 11月CBI工业产出预期差值
  '9533': { metricKey: 'GB.SHORT_BALANCE_GOVERNMENT_REVENUE_EXPENDITURE.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 9月政府收支短差(十亿英镑) | 10月政府收支短差(十亿英镑)
  '9534': { metricKey: 'GB.PUBLIC_DEPARTMENT_NET_BORROWING.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 9月公共部门净借款(十亿英镑) | 10月公共部门净借款(十亿英镑)
  '9540': { metricKey: 'GB.NATIONWIDE_HOUSE_PRICE.NONE.YOY', periodRule: 'month' },  // 3 行 · 9月Nationwide房价指数(年率) | 10月Nationwide房价指数(年率)
  '9541': { metricKey: 'GB.NATIONWIDE_HOUSE_PRICE.NONE.MOM', periodRule: 'month' },  // 3 行 · 9月Nationwide房价指数(月率) | 10月Nationwide房价指数(月率)
  '9544': { metricKey: 'GB.GFK_CONSUMER_CONFIDENCE.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月GFK消费者信心指数 | 11月GFK消费者信心指数
  '9804': { metricKey: 'GB.CORE_RETAIL_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月核心零售物价指数(月率) | 10月核心零售物价指数(月率)
  '9844': { metricKey: 'GB.CORE_RETAIL_SALES.SA.YOY', periodRule: 'month' },  // 2 行 · 9月季调后核心零售销售(年率) | 10月季调后核心零售销售(年率)
  '9845': { metricKey: 'GB.CORE_RETAIL_SALES.SA.MOM', periodRule: 'month' },  // 2 行 · 9月季调后核心零售销售(月率) | 10月季调后核心零售销售(月率)
  '9900': { metricKey: 'GB.GDP.NONE.MOM', periodRule: 'month' },  // 2 行 · 8月GDP(月率) | 9月GDP(月率)
  '9964': { metricKey: 'GB.CIPS_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月制造业采购经理人指数(初值) | 11月制造业采购经理人指数(初值)
  '9966': { metricKey: 'GB.CIPS_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 9月制造业采购经理人指数(终值) | 10月制造业采购经理人指数(终值)
  '9967': { metricKey: 'GB.CIPS_SERVICES_PMI.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月服务业采购经理人指数(初值) | 11月服务业采购经理人指数(初值)
  '9969': { metricKey: 'GB.CIPS_SERVICES_PMI.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 9月服务业采购经理人指数 | 10月服务业采购经理人指数
})
