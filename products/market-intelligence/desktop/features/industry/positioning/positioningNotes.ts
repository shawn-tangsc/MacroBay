/**
 * 持仓卡的四句口径说明（2026-11-08 起收进一颗 ⓘ，不再铺在正文里）。
 *
 * 按平台约定，`Popover` 最多四行——所以原来弹层里的「四条要点 + 四条口径」八句压成这四句。
 * 压掉的四句与理由：
 * - 「费率转负有两种可能：多头走完，或空头在堆」——第 4 句的六档判定已经在做这件事，这句只是把
 *   我们的推理过程讲给读者听；
 * - 「只标骤降不标慢慢跌／图上最大的那段常常没有标记」——压进第 2 句的「连续阴跌不会有标记」；
 * - 「1× 为平常」——第 3 句给了门槛 2×，刻度不需要再解释一遍；
 * - 「把鼠标放在标签上能看到该资产的两个依据数字」——这是操作提示，不是口径，且它一读就能发现。
 *
 * 两语言各一份，放在本卡自己的文件里：`productText.ts` 是热点文件，排队着改。
 */
export const positioningNoteKeys = Object.freeze([
  'positioning.notes.0',
  'positioning.notes.1',
  'positioning.notes.2',
  'positioning.notes.3'
] as const)

export type PositioningNoteKey = (typeof positioningNoteKeys)[number]

const NOTES: Readonly<Record<'zh-CN' | 'en-US', Readonly<Record<PositioningNoteKey, string>>>> = Object.freeze({
  'zh-CN': Object.freeze({
    'positioning.notes.0':
      '线是持仓名义额（1 小时），柱是资金费率（8 小时），都只代表 Binance 一家；两条线各自缩放，高低不能直接比，能比的是线末读数与左侧数字。',
    'positioning.notes.1':
      '标记＝15 分钟内持仓骤降、价格同向、成交放大，三条同时成立；连续阴跌不会有标记。它是推断值，不是交易所强平数据。',
    'positioning.notes.2':
      '量比＝该 15 分钟成交量相对过去 24 小时同长度桶均量的倍数，门槛 2×；季度展期与大额移仓也会满足那三条。',
    'positioning.notes.3':
      '窗口：7 天折叠成每小时 1 点，24 小时用原生 15 分钟。六档判定按 24 小时持仓变化与费率：≤ −5% 且费率回落＝去杠杆，≥ +5% 且费率 < 0＝空头拥挤，≥ +5% 且费率 > +0.03%＝多头拥挤，其余 ≥ +5%＝杠杆回补，|Δ| < 5%＝中性，都不满足不给标签。'
  }),
  'en-US': Object.freeze({
    'positioning.notes.0':
      'The line is notional open interest (hourly), the bars are the funding rate (8-hourly); both cover Binance alone. Each line is scaled to its own range, so heights are not comparable - read the end labels and the numbers on the left.',
    'positioning.notes.1':
      'A mark means open interest collapsed within 15 minutes with price moving the same way and volume expanding, all three at once; a slow decline never marks. It is inferred, not exchange liquidation data.',
    'positioning.notes.2':
      'The multiple is that bucket\u2019s volume over the mean of the previous 24 hours of same-length buckets, threshold 2\u00d7; quarterly rolls and large position moves satisfy the same three conditions.',
    'positioning.notes.3':
      'Window: 7 days folds to one point per hour, 24 hours keeps native 15-minute points. The six states read the 24-hour change and the funding rate: \u2264 \u22125% with a falling rate = deleveraging, \u2265 +5% with a negative rate = short-crowded, \u2265 +5% above +0.03% = long-crowded, other \u2265 +5% = refilling, |\u0394| < 5% = neutral, otherwise no label.'
  })
})

/** 解析器交给 `Popover`：未知键返回空串，浮层整块不渲染（与平台同一条约定）。 */
export function resolvePositioningNote(language: 'zh-CN' | 'en-US'): (key: string) => string {
  return key => (positioningNoteKeys as readonly string[]).includes(key) ? NOTES[language][key as PositioningNoteKey] : ''
}
