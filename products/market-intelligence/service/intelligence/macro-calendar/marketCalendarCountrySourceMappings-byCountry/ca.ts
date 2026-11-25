import type { ZeroXRouterPeriodRule } from '../marketCalendarMetricIdentity'

/**
 * 按国家拆开的「源内 id → 码」映射（CA）。**数据型注册表，纯声明**：一行一个源内身份。
 *
 * 只收期次可定、测度一致的映射；目标码必须存在于码表（守卫在索引里断）。
 */
export const mapping_CA: Readonly<Record<string, Readonly<{ metricKey: string; periodRule: ZeroXRouterPeriodRule }>>> = Object.freeze({
  '9859': { metricKey: 'CA.ECONOMIC_CONFIDENCE.NONE.LEVEL', periodRule: 'month' },
  '213631': { metricKey: 'CA.SP_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '213745': { metricKey: 'CA.TRADE_BALANCE.NONE.LEVEL', periodRule: 'month' },
  '213875': { metricKey: 'CA.CONSTRUCTION_PERMIT.NONE.MOM', periodRule: 'month' },
  '213913': { metricKey: 'CA.MANUFACTURING_SHIPMENTS.NONE.MOM', periodRule: 'month' },
  '213914': { metricKey: 'CA.MANUFACTURING_INVENTORIES.NONE.MOM', periodRule: 'month' },
  '213915': { metricKey: 'CA.MANUFACTURING_INVENTORY_SHIP_RATIO.NONE.LEVEL', periodRule: 'month' },
  '213916': { metricKey: 'CA.MANUFACTURING_OUTSTANDING_ORDERS.NONE.MOM', periodRule: 'month' },
  '213917': { metricKey: 'CA.MANUFACTURING_NEW_ORDERS.NONE.MOM', periodRule: 'month' },
  '213918': { metricKey: 'CA.WHOLESALE_SALES.NONE.MOM', periodRule: 'month' },
  '213919': { metricKey: 'CA.WHOLESALE_SALES.NONE.YOY', periodRule: 'month' },
  '213920': { metricKey: 'CA.WHOLESALE_INVENTORY.NONE.MOM', periodRule: 'month' },
  '213921': { metricKey: 'CA.WHOLESALE_INVENTORIES.NONE.YOY', periodRule: 'month' },
  '213971': { metricKey: 'CA.CANADIAN_INVESTORS_NET_BUY_OVERSEAS_SECURITIES.NONE.AMOUNT', periodRule: 'month' },
  '213972': { metricKey: 'CA.NET_PURCHASES_CANADIAN_SECURITIES_OVERSEAS_INVESTORS.NONE.AMOUNT', periodRule: 'month' },
  '214090': { metricKey: 'CA.CORE_CONSUMER_PRICE_COMMON.NONE.YOY', periodRule: 'month' },
  '214091': { metricKey: 'CA.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '214092': { metricKey: 'CA.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214093': { metricKey: 'CA.CORE_CONSUMER_PRICE_MEDIAN.NONE.YOY', periodRule: 'month' },
  '214094': { metricKey: 'CA.CORE_CONSUMER_PRICE_TUNER.NONE.YOY', periodRule: 'month' },
  '214105': { metricKey: 'CA.INDUSTRIAL_PRODUCT_PRICE.NONE.MOM', periodRule: 'month' },
  '214106': { metricKey: 'CA.INDUSTRIAL_PRICE.NONE.YOY', periodRule: 'month' },
  '214107': { metricKey: 'CA.RAW_MATERIAL_M_PRICE.NONE.MOM', periodRule: 'month' },
  '214108': { metricKey: 'CA.RAW_MATERIAL_M_PRICE.NONE.YOY', periodRule: 'month' },
  '214112': { metricKey: 'CA.NEW_HOME_PRICE.NONE.MOM', periodRule: 'month' },
  '214113': { metricKey: 'CA.NEW_HOME_PRICE.NONE.YOY', periodRule: 'month' },
  '214145': { metricKey: 'CA.RETAIL_SALES.NONE.MOM', periodRule: 'month' },
  '214146': { metricKey: 'CA.CORE_RETAIL_SALES.NONE.MOM', periodRule: 'month' },
  '214343': { metricKey: 'CA.GDP.NONE.MOM', periodRule: 'month' },
  '214344': { metricKey: 'CA.GDP.NONE.YOY', periodRule: 'month' },
  '214389': { metricKey: 'CA.SP_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '214443': { metricKey: 'CA.TRADE_BALANCE.NONE.LEVEL', periodRule: 'month' },
  '214525': { metricKey: 'CA.EXISTING_HOME_SALES.NONE.MOM', periodRule: 'month' },
  '214624': { metricKey: 'CA.CONSTRUCTION_PERMIT.NONE.MOM', periodRule: 'month' },
  '214649': { metricKey: 'CA.MANUFACTURING_SHIPMENTS.NONE.MOM', periodRule: 'month' },
  '214650': { metricKey: 'CA.MANUFACTURING_INVENTORIES.NONE.MOM', periodRule: 'month' },
  '214651': { metricKey: 'CA.MANUFACTURING_INVENTORY_SHIP_RATIO.NONE.LEVEL', periodRule: 'month' },
  '214652': { metricKey: 'CA.MANUFACTURING_OUTSTANDING_ORDERS.NONE.MOM', periodRule: 'month' },
  '214653': { metricKey: 'CA.MANUFACTURING_NEW_ORDERS.NONE.MOM', periodRule: 'month' },
  '214654': { metricKey: 'CA.WHOLESALE_SALES.NONE.MOM', periodRule: 'month' },
  '214655': { metricKey: 'CA.WHOLESALE_SALES.NONE.YOY', periodRule: 'month' },
  '214656': { metricKey: 'CA.WHOLESALE_INVENTORY.NONE.MOM', periodRule: 'month' },
  '214657': { metricKey: 'CA.WHOLESALE_INVENTORIES.NONE.YOY', periodRule: 'month' },
  '214785': { metricKey: 'CA.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214786': { metricKey: 'CA.CORE_CONSUMER_PRICE_COMMON.NONE.YOY', periodRule: 'month' },
  '214787': { metricKey: 'CA.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '214788': { metricKey: 'CA.CORE_CONSUMER_PRICE_TUNER.NONE.YOY', periodRule: 'month' },
  '214789': { metricKey: 'CA.CORE_CONSUMER_PRICE_MEDIAN.NONE.YOY', periodRule: 'month' },
  '214810': { metricKey: 'CA.EXISTING_HOME_SALES.NONE.MOM', periodRule: 'month' },
  '214816': { metricKey: 'CA.CANADIAN_INVESTORS_NET_BUY_OVERSEAS_SECURITIES.NONE.AMOUNT', periodRule: 'month' },
  '214817': { metricKey: 'CA.NET_PURCHASES_CANADIAN_SECURITIES_OVERSEAS_INVESTORS.NONE.AMOUNT', periodRule: 'month' },
  '214898': { metricKey: 'CA.INDUSTRIAL_PRODUCT_PRICE.NONE.MOM', periodRule: 'month' },
  '214899': { metricKey: 'CA.INDUSTRIAL_PRICE.NONE.YOY', periodRule: 'month' },
  '214900': { metricKey: 'CA.RAW_MATERIAL_M_PRICE.NONE.MOM', periodRule: 'month' },
  '214901': { metricKey: 'CA.RAW_MATERIAL_M_PRICE.NONE.YOY', periodRule: 'month' },
  '214938': { metricKey: 'CA.RETAIL_SALES.NONE.MOM', periodRule: 'month' },
  '214939': { metricKey: 'CA.CORE_RETAIL_SALES.NONE.MOM', periodRule: 'month' },
  '214972': { metricKey: 'CA.NEW_HOME_PRICE.NONE.MOM', periodRule: 'month' },
  '214973': { metricKey: 'CA.NEW_HOME_PRICE.NONE.YOY', periodRule: 'month' },
  '4152': { metricKey: 'CA.UNSEASONALLY_IVEY_PURCHASING_MANAGERS.NSA.LEVEL', periodRule: 'current_month' },  // 2 行 · 9月未季调Ivey采购经理人指数 | 10月未季调Ivey采购经理人指数
  '8645': { metricKey: 'CA.UNEMPLOYMENT.NONE.RATE', periodRule: 'month' },  // 2 行 · 9月失业率 | 10月失业率
  '9014': { metricKey: 'CA.MANUFACTURING_SHIPMENTS.NONE.MOM', periodRule: 'month' },  // 2 行 · 8月制造业装船(月率) | 9月制造业装船(月率)
  '9017': { metricKey: 'CA.IMPORTS.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 8月进口(亿加元) | 9月进口(亿加元)
  '9018': { metricKey: 'CA.EXPORTS.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 8月出口(亿加元) | 9月出口(亿加元)
  '9019': { metricKey: 'CA.CURRENT_ACCOUNT.NONE.AMOUNT', periodRule: 'quarter' },  // 1 行 · 第三季度经常帐(十亿加元)
  '9118': { metricKey: 'CA.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月消费者物价指数(年率) | 10月消费者物价指数(年率)
  '9332': { metricKey: 'CA.GDP.NONE.MOM', periodRule: 'month' },  // 2 行 · 8月GDP(月率) | 9月GDP(月率)
  '9335': { metricKey: 'CA.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月消费者物价指数(月率) | 10月消费者物价指数(月率)
  '9337': { metricKey: 'CA.RETAIL_SALES.NONE.MOM', periodRule: 'month' },  // 2 行 · 8月零售销售(月率) | 9月零售销售(月率)
  '9338': { metricKey: 'CA.CORE_RETAIL_SALES.NONE.MOM', periodRule: 'month' },  // 2 行 · 8月核心零售销售(月率) | 9月核心零售销售(月率)
  '9492': { metricKey: 'CA.RAW_MATERIAL_M_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月原材料价格指数(月率) | 10月原材料价格指数(月率)
  '9493': { metricKey: 'CA.INDUSTRIAL_PRODUCT_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月工业品物价指数(月率) | 10月工业品物价指数(月率)
  '9494': { metricKey: 'CA.CONSTRUCTION_PERMIT.NONE.MOM', periodRule: 'month' },  // 2 行 · 8月营建许可(月率) | 9月营建许可(月率)
  '9495': { metricKey: 'CA.NEW_HOUSING_STARTS.NONE.COUNT', periodRule: 'month' },  // 2 行 · 9月新屋开工(千户) | 10月新屋开工(千户)
  '9496': { metricKey: 'CA.NEW_HOME_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月新屋价格指数(年率) | 10月新屋价格指数(年率)
  '9497': { metricKey: 'CA.NEW_HOME_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月新屋价格指数(月率) | 10月新屋价格指数(月率)
  '9498': { metricKey: 'CA.CANADIAN_INVESTORS_NET_BUY_OVERSEAS_SECURITIES.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 8月加拿大投资者净买入海外证券(亿加元) | 9月加拿大投资者净买入海外证券(亿加元)
  '9499': { metricKey: 'CA.NET_PURCHASES_CANADIAN_SECURITIES_OVERSEAS_INVESTORS.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 8月海外投资者净买入加拿大证券(十亿加元) | 9月海外投资者净买入加拿大证券(十亿加元
  '9500': { metricKey: 'CA.MANUFACTURING_OUTSTANDING_ORDERS.NONE.MOM', periodRule: 'month' },  // 2 行 · 8月制造业未完成订单(月率) | 9月制造业未完成订单(月率)
  '9501': { metricKey: 'CA.MANUFACTURING_NEW_ORDERS.NONE.MOM', periodRule: 'month' },  // 2 行 · 8月制造业新订单(月率) | 9月制造业新订单(月率)
  '9503': { metricKey: 'CA.MANUFACTURING_INVENTORIES.NONE.MOM', periodRule: 'month' },  // 2 行 · 8月制造业库存(月率) | 9月制造业库存(月率)
  '9504': { metricKey: 'CA.MANUFACTURING_INVENTORY_SHIP_RATIO.NONE.LEVEL', periodRule: 'month' },  // 2 行 · 8月制造业库存装船比 | 9月制造业库存装船比
  '9505': { metricKey: 'CA.WHOLESALE_SALES.NONE.MOM', periodRule: 'month' },  // 2 行 · 8月批发销售(月率) | 9月批发销售(月率)
  '9506': { metricKey: 'CA.WHOLESALE_SALES.NONE.YOY', periodRule: 'month' },  // 2 行 · 8月批发销售(年率) | 9月批发销售(年率)
  '9507': { metricKey: 'CA.WHOLESALE_INVENTORY.NONE.MOM', periodRule: 'month' },  // 2 行 · 8月批发库存(月率) | 9月批发库存(月率)
  '9508': { metricKey: 'CA.WHOLESALE_INVENTORIES.NONE.YOY', periodRule: 'month' },  // 2 行 · 8月批发库存(年率) | 9月批发库存(年率)
  '9753': { metricKey: 'CA.RAW_MATERIAL_M_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月原材料物价指数(年率) | 10月原材料物价指数(年率)
  '9754': { metricKey: 'CA.INDUSTRIAL_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月工业品物价指数(年率) | 10月工业品物价指数(年率)
  '9838': { metricKey: 'CA.SP_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 9月标普全球制造业采购经理人指数 | 10月标普全球制造业采购经理人指数
  '9864': { metricKey: 'CA.EXISTING_HOME_SALES.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月成屋销售(月率) | 10月成屋销售(月率)
  '9878': { metricKey: 'CA.GDP.NONE.YOY', periodRule: 'month' },  // 2 行 · 8月GDP(年率) | 9月GDP(年率)
  '9891': { metricKey: 'CA.IVEY_PURCHASING_MANAGERS.SA.LEVEL', periodRule: 'current_month' },  // 2 行 · 9月季调后Ivey采购经理人指数 | 10月季调后Ivey采购经理人指数
  '9922': { metricKey: 'CA.CORE_CONSUMER_PRICE_COMMON.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月核心消费者物价指数-常用指数(年率) | 10月核心消费者物价指数-常用指数(年率)
  '9923': { metricKey: 'CA.CORE_CONSUMER_PRICE_MEDIAN.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月核心消费者物价指数-中位数(年率) | 10月核心消费者物价指数-中位数(年率)
  '9924': { metricKey: 'CA.CORE_CONSUMER_PRICE_TUNER.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月核心消费者物价指数-调整指数(年率) | 10月核心消费者物价指数-调整指数(年率)
})
