import type { ZeroXRouterPeriodRule } from '../marketCalendarMetricIdentity'

/**
 * 按国家拆开的「源内 id → 码」映射（KR）。**数据型注册表，纯声明**：一行一个源内身份。
 *
 * 只收期次可定、测度一致的映射；目标码必须存在于码表（守卫在索引里断）。
 */
export const mapping_KR: Readonly<Record<string, Readonly<{ metricKey: string; periodRule: ZeroXRouterPeriodRule }>>> = Object.freeze({
  '213612': { metricKey: 'KR.TRADE_BALANCE.NONE.LEVEL', periodRule: 'month' },
  '213614': { metricKey: 'KR.SP_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '213640': { metricKey: 'KR.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '213641': { metricKey: 'KR.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '213642': { metricKey: 'KR.CORE_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '213890': { metricKey: 'KR.L_MONEY_SUPPLY.NONE.MOM', periodRule: 'month' },
  '213891': { metricKey: 'KR.L_MONEY_SUPPLY.NONE.YOY', periodRule: 'month' },
  '213892': { metricKey: 'KR.MONEY_SUPPLY_M2.NONE.MOM', periodRule: 'month' },
  '213945': { metricKey: 'KR.EXPORTS_PRICE.NONE.YOY', periodRule: 'month' },
  '213946': { metricKey: 'KR.IMPORTS_PRICE.NONE.YOY', periodRule: 'month' },
  '213950': { metricKey: 'KR.UNEMPLOYMENT.SA.MOM', periodRule: 'month' },
  '214065': { metricKey: 'KR.PRODUCER_PRICE.NONE.YOY', periodRule: 'month' },
  '214066': { metricKey: 'KR.PRODUCER_PRICE.NONE.MOM', periodRule: 'month' },
  '214211': { metricKey: 'KR.REAL_GDP.NONE.QOQ', periodRule: 'quarter' },
  '214212': { metricKey: 'KR.REAL_GDP.NONE.YOY', periodRule: 'month' },
  '214294': { metricKey: 'KR.INDUSTRIAL_OUTPUT.SA.MOM', periodRule: 'month' },
  '214295': { metricKey: 'KR.INDUSTRIAL_OUTPUT.NONE.YOY', periodRule: 'month' },
  '214357': { metricKey: 'KR.TRADE_BALANCE.NONE.LEVEL', periodRule: 'month' },
  '214376': { metricKey: 'KR.SP_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '214400': { metricKey: 'KR.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '214401': { metricKey: 'KR.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214402': { metricKey: 'KR.CORE_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214591': { metricKey: 'KR.UNEMPLOYMENT.SA.MOM', periodRule: 'month' },
  '214628': { metricKey: 'KR.EXPORTS_PRICE.NONE.YOY', periodRule: 'month' },
  '214629': { metricKey: 'KR.IMPORTS_PRICE.NONE.YOY', periodRule: 'month' },
  '214631': { metricKey: 'KR.L_MONEY_SUPPLY.NONE.MOM', periodRule: 'month' },
  '214632': { metricKey: 'KR.L_MONEY_SUPPLY.NONE.YOY', periodRule: 'month' },
  '214633': { metricKey: 'KR.MONEY_SUPPLY_M2.NONE.MOM', periodRule: 'month' },
  '214712': { metricKey: 'KR.IMPORTS.NONE.YOY', periodRule: 'month' },
  '214713': { metricKey: 'KR.IMPORTS.NONE.YOY', periodRule: 'month' },
  '214714': { metricKey: 'KR.EXPORTS.NONE.YOY', periodRule: 'month' },
  '214715': { metricKey: 'KR.EXPORTS.NONE.YOY', periodRule: 'month' },
  '214917': { metricKey: 'KR.PRODUCER_PRICE.NONE.YOY', periodRule: 'month' },
  '214918': { metricKey: 'KR.PRODUCER_PRICE.NONE.MOM', periodRule: 'month' },
  '10207': { metricKey: 'KR.REAL_GDP.NONE.QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度实际GDP初值(季率)
  '10210': { metricKey: 'KR.REAL_GDP.NONE.YOY', periodRule: 'quarter' },  // 1 行 · 第三季度实际GDP初值(年率)
  '10284': { metricKey: 'KR.TRADE_ACCOUNT.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 9月贸易帐(百万美元)（初值） | 10月贸易帐(百万美元)（初值）
  '4177': { metricKey: 'KR.CURRENT_ACCOUNT.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 8月经常帐(百万美元) | 9月经常帐(百万美元)
  '4180': { metricKey: 'KR.UNEMPLOYMENT.SA.MOM', periodRule: 'month' },  // 2 行 · 9月季调后失业率(月率) | 10月季调后失业率(月率)
  '9670': { metricKey: 'KR.PRODUCER_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月生产者物价指数(月率) | 10月生产者物价指数(月率)
  '9671': { metricKey: 'KR.PRODUCER_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月生产者物价指数(年率) | 10月生产者物价指数(年率)
  '9672': { metricKey: 'KR.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月消费者物价指数(月率) | 10月消费者物价指数(月率)
  '9673': { metricKey: 'KR.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月消费者物价指数(年率) | 10月消费者物价指数(年率)
  '9674': { metricKey: 'KR.INDUSTRIAL_OUTPUT.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月工业产出(年率) | 10月工业产出(年率)
  '9675': { metricKey: 'KR.INDUSTRIAL_OUTPUT.SA.MOM', periodRule: 'month' },  // 2 行 · 9月季调后工业产出(月率) | 10月季调后工业产出(月率)
  '9677': { metricKey: 'KR.IMPORTS_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月进口物价指数(年率) | 10月进口物价指数(年率)
  '9678': { metricKey: 'KR.EXPORTS_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月出口物价指数(年率) | 10月出口物价指数(年率)
  '9679': { metricKey: 'KR.EXPORTS.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月出口(年率) | 10月出口(年率)
  '9680': { metricKey: 'KR.IMPORTS.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月进口(年率) | 10月进口(年率)
  '9682': { metricKey: 'KR.CONSUMER_CONFIDENCE.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月消费者信心指数 | 11月消费者信心指数
  '9683': { metricKey: 'KR.L_MONEY_SUPPLY.NONE.YOY', periodRule: 'month' },  // 2 行 · 8月L货币供应(年率) | 9月L货币供应(年率)
  '9841': { metricKey: 'KR.CORE_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月核心消费者物价指数(年率) | 10月核心消费者物价指数(年率)
  '9866': { metricKey: 'KR.L_MONEY_SUPPLY.NONE.MOM', periodRule: 'month' },  // 2 行 · 8月L货币供应(月率) | 9月L货币供应(月率)
  '9869': { metricKey: 'KR.MONEY_SUPPLY_M2.NONE.MOM', periodRule: 'month' },  // 2 行 · 8月货币供应M2(月率) | 9月货币供应M2(月率)
  '9880': { metricKey: 'KR.SP_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 9月制造业采购经理人指数 | 10月制造业采购经理人指数
  '9882': { metricKey: 'KR.FOREIGN_EXCHANGE_RESERVES.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 9月外汇储备(十亿美元) | 10月外汇储备(十亿美元)
})
