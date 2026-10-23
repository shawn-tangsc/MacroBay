/**
 * The cross-asset panel's own number formats.
 *
 * They live here rather than in the panel because more than one surface now prints the same figure: the
 * status table's window cells and the reading line under the chart. Two copies of "how a signed percent
 * looks" would drift, and a reader comparing 「+0.42%」 in the table with 「涨了 0.42%」 in the reading
 * should be looking at the same rounding.
 */
/** 幅度：方向已经由词说出来了（「跌了 …」），数字再带一个负号就是重复。 */
export function crossAssetMagnitudeValue(value: number, unit: string): string {
  const absolute = Math.abs(value)
  return `${absolute > 0 && absolute < .01 ? '<0.01' : absolute.toFixed(2)}${unit}`
}

export function crossAssetSignedValue(value: number, unit: string): string {
  const absolute = Math.abs(value)
  // The minus is U+2212, the product's own: a hyphen reads as a dash at this size.
  return `${value < 0 ? '−' : value > 0 ? '+' : ''}${absolute > 0 && absolute < .01 ? '<0.01' : absolute.toFixed(2)}${unit}`
}
