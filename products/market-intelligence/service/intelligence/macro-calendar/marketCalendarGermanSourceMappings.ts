import type { ZeroXRouterPeriodRule } from './marketCalendarMetricIdentity'

/**
 * **德国（0xrouter）的「源内 id → 指标码」表与码名表**（用户 2026-11-17）。
 *
 * 与美国的码空间**按来源分开**：德国自己一张表，新来源接入时只新增一张，不改动别人的表。
 * 生成依据：`/tmp/mc-es/de-codes-v2.tsv`（按锚点收敛、`NONE`/`NSA` 按该族有无季调档区分、
 * 残句不派生族名）。**不在这里重新推导码名**。
 *
 * 名表只填源给了可读中英名的那些；残句（`day Tuner…`、`transmutation…`）不进这张表，
 * 它们的 id 也不建码——看着像合法码的族名一旦存在，生成器以后会往它上面继续叠。
 */
export const germanSourceMetricMappings: Readonly<Record<string, Readonly<{ metricKey: string; periodRule: ZeroXRouterPeriodRule }>>> = Object.freeze({
  // 已有指标换了个 id（同一码的月度变体）：**只加映射，名表不动**——那四个码的四列名本来就有。
  '212227': { metricKey: 'DE.MANUFACTURING_ORDERS.SA.MOM', periodRule: 'month' },
  '212262': { metricKey: 'DE.EXPORTS.SA.MOM', periodRule: 'month' },
  '212264': { metricKey: 'DE.INDUSTRIAL_OUTPUT.SA.MOM', periodRule: 'month' },
  '213207': { metricKey: 'DE.ZEW_ECONOMIC_STATUS.NONE.LEVEL', periodRule: 'month' },
  '214634': { metricKey: 'DE.WHOLESALE_PRICE.NONE.MOM', periodRule: 'month' },
  '214635': { metricKey: 'DE.WHOLESALE_PRICE.NONE.YOY', periodRule: 'month' },
  '213623': { metricKey: 'DE.MARKIT_BME_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '213714': { metricKey: 'DE.MARKIT_BME_COMPOSITE_PURCHASING.NONE.LEVEL', periodRule: 'month' },
  '213715': { metricKey: 'DE.MARKIT_BME_SERVICES_PURCHASING.NONE.LEVEL', periodRule: 'month' },
  '213736': { metricKey: 'DE.UNADJUSTED_MANUFACTURING_ORDERS.NONE.YOY', periodRule: 'month' },
  '213737': { metricKey: 'DE.MANUFACTURING_ORDERS.SA.MOM', periodRule: 'month' },
  '213741': { metricKey: 'DE.MARKIT_BME_CONSTRUCTION_PURCHASING.NONE.LEVEL', periodRule: 'month' },
  '213763': { metricKey: 'DE.INDUSTRIAL_OUTPUT.SA.MOM', periodRule: 'month' },
  '213787': { metricKey: 'DE.EXPORTS.SA.MOM', periodRule: 'month' },
  '213788': { metricKey: 'DE.IMPORTS.SA.MOM', periodRule: 'month' },
  '213789': { metricKey: 'DE.ADJUSTED_TRADE_BALANCE.SA.LEVEL', periodRule: 'month' },
  '213843': { metricKey: 'DE.CPI.NSA.MOM', periodRule: 'month' },
  '213844': { metricKey: 'DE.CPI.NSA.YOY', periodRule: 'month' },
  '213845': { metricKey: 'DE.HICP.NSA.MOM', periodRule: 'month' },
  '213846': { metricKey: 'DE.HICP.NSA.YOY', periodRule: 'month' },
  '213869': { metricKey: 'DE.WHOLESALE_PRICE.NONE.MOM', periodRule: 'month' },
  '213870': { metricKey: 'DE.WHOLESALE_PRICE.NONE.YOY', periodRule: 'month' },
  '214041': { metricKey: 'DE.PRODUCER_PRICE.NONE.MOM', periodRule: 'month' },
  '214042': { metricKey: 'DE.PRODUCER_PRICE.NONE.YOY', periodRule: 'month' },
  '214056': { metricKey: 'DE.ZEW_ECONOMIC_STATUS.NONE.LEVEL', periodRule: 'month' },
  '214059': { metricKey: 'DE.ZEW_ECONOMIC_SENTIMENT.NONE.LEVEL', periodRule: 'month' },
  '214134': { metricKey: 'DE.MARKIT_BME_COMPOSITE_PURCHASING.NONE.LEVEL', periodRule: 'month' },
  '214135': { metricKey: 'DE.MARKIT_BME_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '214136': { metricKey: 'DE.MARKIT_BME_SERVICES_PURCHASING.NONE.LEVEL', periodRule: 'month' },
  '214199': { metricKey: 'DE.IFO_BUSINESS_CLIMATE.NONE.LEVEL', periodRule: 'month' },
  '214200': { metricKey: 'DE.IFO_BUSINESS_STATUS.NONE.LEVEL', periodRule: 'month' },
  '214201': { metricKey: 'DE.IFO_BUSINESS_EXPECTATIONS.NONE.LEVEL', periodRule: 'month' },
  '214240': { metricKey: 'DE.GFK_CONSUMER_CONFIDENCE.NONE.LEVEL', periodRule: 'month' },
  '214315': { metricKey: 'DE.IMPORTS_PRICE.NONE.MOM', periodRule: 'month' },
  '214316': { metricKey: 'DE.IMPORTS_PRICE.NONE.YOY', periodRule: 'month' },
  '214317': { metricKey: 'DE.EXPORTS_PRICE.NONE.MOM', periodRule: 'month' },
  '214318': { metricKey: 'DE.EXPORTS_PRICE.NONE.YOY', periodRule: 'month' },
  '214331': { metricKey: 'DE.GDP.NSA.YOY', periodRule: 'month' },
  '214332': { metricKey: 'DE.GDP.SA.QOQ', periodRule: 'month' },
  '214346': { metricKey: 'DE.CPI.NSA.MOM', periodRule: 'month' },
  '214347': { metricKey: 'DE.CPI.NSA.YOY', periodRule: 'month' },
  '214348': { metricKey: 'DE.HICP.NSA.MOM', periodRule: 'month' },
  '214349': { metricKey: 'DE.HICP.NSA.YOY', periodRule: 'month' },
  '214352': { metricKey: 'DE.UNEMPLOYMENT.SA.RATE', periodRule: 'month' },
  '214353': { metricKey: 'DE.TOTAL_NUMBER_OF_UNEMPLOYED.SA.LEVEL', periodRule: 'month' },
  '214354': { metricKey: 'DE.TOTAL_NUMBER_OF_UNEMPLOYED.NONE.LEVEL', periodRule: 'month' },
  '214380': { metricKey: 'DE.ACTUAL_RETAIL_SALES.NONE.MOM', periodRule: 'month' },
  '214381': { metricKey: 'DE.ACTUAL_RETAIL_SALES.NONE.YOY', periodRule: 'month' },
  '214386': { metricKey: 'DE.MARKIT_BME_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '214430': { metricKey: 'DE.MARKIT_BME_COMPOSITE_PURCHASING.NONE.LEVEL', periodRule: 'month' },
  '214431': { metricKey: 'DE.MARKIT_BME_SERVICES_PURCHASING.NONE.LEVEL', periodRule: 'month' },
  '214459': { metricKey: 'DE.UNADJUSTED_MANUFACTURING_ORDERS.NONE.YOY', periodRule: 'month' },
  '214460': { metricKey: 'DE.MANUFACTURING_ORDERS.SA.MOM', periodRule: 'month' },
  '214467': { metricKey: 'DE.MARKIT_BME_CONSTRUCTION_PURCHASING.NONE.LEVEL', periodRule: 'month' },
  '214493': { metricKey: 'DE.INDUSTRIAL_OUTPUT.SA.MOM', periodRule: 'month' },
  '214549': { metricKey: 'DE.EXPORTS.SA.MOM', periodRule: 'month' },
  '214550': { metricKey: 'DE.IMPORTS.SA.MOM', periodRule: 'month' },
  '214551': { metricKey: 'DE.ADJUSTED_TRADE_BALANCE.SA.LEVEL', periodRule: 'month' },
  '214594': { metricKey: 'DE.CPI.NSA.MOM', periodRule: 'month' },
  '214595': { metricKey: 'DE.CPI.NSA.YOY', periodRule: 'month' },
  '214596': { metricKey: 'DE.HICP.NSA.MOM', periodRule: 'month' },
  '214597': { metricKey: 'DE.HICP.NSA.YOY', periodRule: 'month' },
  '214811': { metricKey: 'DE.ZEW_ECONOMIC_STATUS.NONE.LEVEL', periodRule: 'month' },
  '214814': { metricKey: 'DE.ZEW_ECONOMIC_SENTIMENT.NONE.LEVEL', periodRule: 'month' },
  '214925': { metricKey: 'DE.PRODUCER_PRICE.NONE.MOM', periodRule: 'month' },
  '214926': { metricKey: 'DE.PRODUCER_PRICE.NONE.YOY', periodRule: 'month' },
  '214960': { metricKey: 'DE.MARKIT_BME_COMPOSITE_PURCHASING.NONE.LEVEL', periodRule: 'month' },
  '214961': { metricKey: 'DE.MARKIT_BME_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '214962': { metricKey: 'DE.MARKIT_BME_SERVICES_PURCHASING.NONE.LEVEL', periodRule: 'month' },
  '214981': { metricKey: 'DE.IFO_BUSINESS_CLIMATE.NONE.LEVEL', periodRule: 'month' },
  '214982': { metricKey: 'DE.IFO_BUSINESS_STATUS.NONE.LEVEL', periodRule: 'month' },
  '214983': { metricKey: 'DE.IFO_BUSINESS_EXPECTATIONS.NONE.LEVEL', periodRule: 'month' },
  '215001': { metricKey: 'DE.GDP.NSA.YOY', periodRule: 'month' },
  '215002': { metricKey: 'DE.GDP.SA.QOQ', periodRule: 'month' },
  '215037': { metricKey: 'DE.GFK_CONSUMER_CONFIDENCE.NONE.LEVEL', periodRule: 'month' },
})

/**
 * 码 → 四列名。
 *
 * **名字由码决定，不由某一期决定**（用户 2026-11-17 的教训）：早先这 35 条是照源样本名抄的，
 * 于是每条名字里都带着「9月」「终值」——十月的事件会显示成「9月…」，而 `DE.CPI.NSA.MOM` 与
 * `.YOY` 两个不同的数**显示成同一个名字**。所以这里：
 *
 * - 不含期次（不出现「9月」「第三季度」）；
 * - 不含修订阶段（「终值」「初值」是同一码的两次发布，不是名字）；
 * - 同族不同测度必须能分辨（`消费者物价指数（月率）` / `（年率）`）；
 * - `enShort` 是**独立写出来的短名**（`German CPI MoM`），不是把 `enFull` 截到 20 字——
 *   截断会截在词中间，还会留下不平衡的括号。
 */
export const germanMetricNames: Readonly<Record<string, Readonly<{ zhFull: string; zhShort: string; enFull: string; enShort: string }>>> = Object.freeze({
  'DE.ACTUAL_RETAIL_SALES.NONE.MOM': { zhFull: '实际零售销售（月率）', zhShort: '实际零售销售', enFull: 'Actual Retail Sales (MoM)', enShort: 'German Retail Sales MoM' },
  'DE.ACTUAL_RETAIL_SALES.NONE.YOY': { zhFull: '实际零售销售（年率）', zhShort: '实际零售销售', enFull: 'Actual Retail Sales (YoY)', enShort: 'German Retail Sales YoY' },
  'DE.ADJUSTED_TRADE_BALANCE.SA.LEVEL': { zhFull: '季调后贸易帐（十亿欧元）', zhShort: '季调后贸易帐', enFull: 'Seasonally Adjusted Trade Balance (billion EUR)', enShort: 'German Trade Balance SA' },
  'DE.CPI.NSA.MOM': { zhFull: '消费者物价指数（月率）', zhShort: '消费者物价指数', enFull: 'Consumer Price Index (MoM)', enShort: 'German CPI MoM' },
  'DE.CPI.NSA.YOY': { zhFull: '消费者物价指数（年率）', zhShort: '消费者物价指数', enFull: 'Consumer Price Index (YoY)', enShort: 'German CPI YoY' },
  'DE.EXPORTS.SA.MOM': { zhFull: '季调后出口（月率）', zhShort: '季调后出口', enFull: 'Seasonally Adjusted Exports (MoM)', enShort: 'German Exports MoM' },
  'DE.EXPORTS_PRICE.NONE.MOM': { zhFull: '出口物价指数（月率）', zhShort: '出口物价指数', enFull: 'Export Price Index (MoM)', enShort: 'German Export Prices MoM' },
  'DE.EXPORTS_PRICE.NONE.YOY': { zhFull: '出口物价指数（年率）', zhShort: '出口物价指数', enFull: 'Export Price Index (YoY)', enShort: 'German Export Prices YoY' },
  'DE.GDP.SA.QOQ': { zhFull: '季调后国内生产总值（季率）', zhShort: '季调后GDP', enFull: 'Seasonally Adjusted GDP (QoQ)', enShort: 'German GDP QoQ SA' },
  'DE.GFK_CONSUMER_CONFIDENCE.NONE.LEVEL': { zhFull: 'GfK消费者信心指数', zhShort: 'GfK消费者信心', enFull: 'GfK Consumer Confidence Index', enShort: 'German GfK Confidence' },
  'DE.HICP.NSA.MOM': { zhFull: '调和消费者物价指数（月率）', zhShort: '调和消费者物价指数', enFull: 'Harmonised Index of Consumer Prices (MoM)', enShort: 'German HICP MoM' },
  'DE.HICP.NSA.YOY': { zhFull: '调和消费者物价指数（年率）', zhShort: '调和消费者物价指数', enFull: 'Harmonised Index of Consumer Prices (YoY)', enShort: 'German HICP YoY' },
  'DE.IFO_BUSINESS_CLIMATE.NONE.LEVEL': { zhFull: 'IFO商业景气指数', zhShort: 'IFO商业景气', enFull: 'Ifo Business Climate Index', enShort: 'German Ifo Climate' },
  'DE.IFO_BUSINESS_EXPECTATIONS.NONE.LEVEL': { zhFull: 'IFO商业预期指数', zhShort: 'IFO商业预期', enFull: 'Ifo Business Expectations Index', enShort: 'German Ifo Expectations' },
  'DE.IFO_BUSINESS_STATUS.NONE.LEVEL': { zhFull: 'IFO商业现况指数', zhShort: 'IFO商业现况', enFull: 'Ifo Business Situation Index', enShort: 'German Ifo Situation' },
  'DE.IMPORTS.SA.MOM': { zhFull: '季调后进口（月率）', zhShort: '季调后进口', enFull: 'Seasonally Adjusted Imports (MoM)', enShort: 'German Imports MoM' },
  'DE.IMPORTS_PRICE.NONE.MOM': { zhFull: '进口物价指数（月率）', zhShort: '进口物价指数', enFull: 'Import Price Index (MoM)', enShort: 'German Import Prices MoM' },
  'DE.IMPORTS_PRICE.NONE.YOY': { zhFull: '进口物价指数（年率）', zhShort: '进口物价指数', enFull: 'Import Price Index (YoY)', enShort: 'German Import Prices YoY' },
  'DE.INDUSTRIAL_OUTPUT.SA.MOM': { zhFull: '季调后工业产出（月率）', zhShort: '季调后工业产出', enFull: 'Seasonally Adjusted Industrial Output (MoM)', enShort: 'German Industrial Output MoM' },
  'DE.MANUFACTURING_ORDERS.SA.MOM': { zhFull: '季调后制造业订单（月率）', zhShort: '季调后制造业订单', enFull: 'Seasonally Adjusted Manufacturing Orders (MoM)', enShort: 'German Factory Orders MoM' },
  'DE.MARKIT_BME_COMPOSITE_PURCHASING.NONE.LEVEL': { zhFull: '综合采购经理人指数', zhShort: '综合PMI', enFull: 'Composite Purchasing Managers Index', enShort: 'German Composite PMI' },
  'DE.MARKIT_BME_CONSTRUCTION_PURCHASING.NONE.LEVEL': { zhFull: '建筑业采购经理人指数', zhShort: '建筑业PMI', enFull: 'Construction Purchasing Managers Index', enShort: 'German Construction PMI' },
  'DE.MARKIT_BME_MANUFACTURING_PMI.NONE.LEVEL': { zhFull: '制造业采购经理人指数', zhShort: '制造业PMI', enFull: 'Manufacturing Purchasing Managers Index', enShort: 'German Manufacturing PMI' },
  'DE.MARKIT_BME_SERVICES_PURCHASING.NONE.LEVEL': { zhFull: '服务业采购经理人指数', zhShort: '服务业PMI', enFull: 'Services Purchasing Managers Index', enShort: 'German Services PMI' },
  'DE.PRODUCER_PRICE.NONE.MOM': { zhFull: '生产者物价指数（月率）', zhShort: '生产者物价指数', enFull: 'Producer Price Index (MoM)', enShort: 'German PPI MoM' },
  'DE.PRODUCER_PRICE.NONE.YOY': { zhFull: '生产者物价指数（年率）', zhShort: '生产者物价指数', enFull: 'Producer Price Index (YoY)', enShort: 'German PPI YoY' },
  'DE.TOTAL_NUMBER_OF_UNEMPLOYED.NONE.LEVEL': { zhFull: '未季调失业人数（万人）', zhShort: '未季调失业人数', enFull: 'Unadjusted Number of Unemployed (10k people)', enShort: 'German Unemployed NSA' },
  'DE.TOTAL_NUMBER_OF_UNEMPLOYED.SA.LEVEL': { zhFull: '季调后失业人数（万人）', zhShort: '季调后失业人数', enFull: 'Seasonally Adjusted Number of Unemployed (10k people)', enShort: 'German Unemployed SA' },
  'DE.UNADJUSTED_MANUFACTURING_ORDERS.NONE.YOY': { zhFull: '未季调制造业订单（年率）', zhShort: '未季调制造业订单', enFull: 'Unadjusted Manufacturing Orders (YoY)', enShort: 'German Factory Orders NSA YoY' },
  'DE.UNEMPLOYMENT.SA.RATE': { zhFull: '季调后失业率（官方）', zhShort: '季调后失业率', enFull: 'Seasonally Adjusted Unemployment Rate (Official)', enShort: 'German Unemployment Rate SA' },
  'DE.GDP.NSA.YOY': { zhFull: '未季调国内生产总值（年率）', zhShort: '未季调GDP', enFull: 'Unadjusted GDP (YoY)', enShort: 'German GDP YoY NSA' },
  'DE.WHOLESALE_PRICE.NONE.MOM': { zhFull: '批发物价指数（月率）', zhShort: '批发物价指数', enFull: 'Wholesale Price Index (MoM)', enShort: 'German Wholesale Prices MoM' },
  'DE.WHOLESALE_PRICE.NONE.YOY': { zhFull: '批发物价指数（年率）', zhShort: '批发物价指数', enFull: 'Wholesale Price Index (YoY)', enShort: 'German Wholesale Prices YoY' },
  'DE.ZEW_ECONOMIC_SENTIMENT.NONE.LEVEL': { zhFull: 'ZEW经济景气指数', zhShort: 'ZEW经济景气', enFull: 'ZEW Economic Sentiment Index', enShort: 'German ZEW Sentiment' },
  'DE.ZEW_ECONOMIC_STATUS.NONE.LEVEL': { zhFull: 'ZEW经济现况指数', zhShort: 'ZEW经济现况', enFull: 'ZEW Economic Situation Index', enShort: 'German ZEW Situation' },
})

/** 展示开关轴（`tier`）：德国**一级 0 个**、二级这 7 个、其余不写（不写即未分级）。 */
export const germanTierByMetricKey: Readonly<Record<string, 1 | 2 | 3>> = Object.freeze({
  'DE.CPI.NSA.YOY': 2,
  'DE.HICP.NSA.YOY': 2,
  'DE.GDP.SA.QOQ': 2,
  'DE.UNEMPLOYMENT.SA.RATE': 2,
  'DE.IFO_BUSINESS_CLIMATE.NONE.LEVEL': 2,
  'DE.ZEW_ECONOMIC_SENTIMENT.NONE.LEVEL': 2,
  'DE.SP_MANUFACTURING_PMI.SA.LEVEL': 2,
})
