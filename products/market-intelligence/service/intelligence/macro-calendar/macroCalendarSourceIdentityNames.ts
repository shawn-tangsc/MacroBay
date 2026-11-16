/**
 * **按源内身份索引的显示名表**（2026-11-16，用户定：德国那批只补显示名）。
 *
 * 为什么单独一张表：德国那 159 条数组身份（`["9553",...]`）**没有指标码**，也不该有——
 * 建 `DE.*` 码要连分级、显示名、官方地址族一起定义，属于产品级决定（#46）。但它们的英文名
 * 是机翻残句（`day Tuner`、`transmutation…`），读者根本看不出是什么，所以只补**名字**。
 *
 * 三条边界：
 * 1. **不许写进 `metric_key`**：那会让身份看起来已经映射好，实际是我们编的（#36 的同一个错）；
 * 2. **只按源内身份（数组第一段）索引**，不碰码表、不做跨源合并、不参与分级——有意为之；
 * 3. 依据是「该行源给的中文名 + 指标常识」，逐条写在这里；认不出的**留空**，回退源原文名。
 *
 * 覆盖：先补按行数排序的前 27 个德国身份（占德国数组身份行的大头），其余回退源原文名。
 */
export const sourceIdentityDisplayNames: Readonly<Record<string, Readonly<{ zh: string; en: string }>>> =
  Object.freeze({
    '9553': { zh: '批发物价指数(年率)', en: 'Wholesale Price Index (YoY)' },
    '9554': { zh: '批发物价指数(月率)', en: 'Wholesale Price Index (MoM)' },
    '10273': { zh: '综合采购经理人指数(初值)', en: 'Composite PMI (Preliminary)' },
    '4131': { zh: 'Ifo 商业景气指数', en: 'Ifo Business Climate' },
    '9380': { zh: 'Ifo 商业现况指数', en: 'Ifo Current Conditions' },
    '9381': { zh: 'Ifo 商业预期指数', en: 'Ifo Expectations' },
    '9979': { zh: '制造业采购经理人指数(初值)', en: 'Manufacturing PMI (Preliminary)' },
    '9982': { zh: '服务业采购经理人指数(初值)', en: 'Services PMI (Preliminary)' },
    '9021': { zh: '季调后失业人数变化', en: 'Unemployment Change (SA)' },
    '9378': { zh: 'ZEW 经济现况指数', en: 'ZEW Current Conditions' },
    '9774': { zh: '季调后出口(月率)', en: 'Exports (MoM, SA)' },
    '9775': { zh: '季调后制造业订单(月率)', en: 'Manufacturing Orders (MoM, SA)' },
    '9776': { zh: '季调后工业产出(月率)', en: 'Industrial Production (MoM, SA)' },
    '10143': { zh: '消费者物价指数(月率,终值)', en: 'CPI (MoM, Final)' },
    '10146': { zh: '消费者物价指数(年率,终值)', en: 'CPI (YoY, Final)' },
    '10149': { zh: '调和消费者物价指数(月率,终值)', en: 'HICP (MoM, Final)' },
    '10152': { zh: '调和消费者物价指数(年率,终值)', en: 'HICP (YoY, Final)' },
    '10275': { zh: '综合采购经理人指数(终值)', en: 'Composite PMI (Final)' },
    '4138': { zh: '季调后失业率', en: 'Unemployment Rate (SA)' },
    '4141': { zh: '季调后贸易帐', en: 'Trade Balance (SA)' },
    '9022': { zh: '季调后失业总人数', en: 'Unemployed Persons (SA)' },
    '9023': { zh: '工作日调整后工业产出(年率)', en: 'Industrial Production (YoY, Working Day Adjusted)' },
    '9547': { zh: '未季调失业总人数', en: 'Unemployed Persons (NSA)' },
    '9548': { zh: '未季调制造业订单(年率)', en: 'Manufacturing Orders (YoY, NSA)' },
    '9555': { zh: '生产者物价指数(月率)', en: 'Producer Price Index (MoM)' },
    '9556': { zh: '生产者物价指数(年率)', en: 'Producer Price Index (YoY)' },
    '9557': { zh: 'GfK 消费者信心指数', en: 'GfK Consumer Confidence' }
  })
