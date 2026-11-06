/**
 * 信号通知里**两个生产者都要用同一份算法**的两处（情报 v3.26 §十一）：
 * 资产怎么显示、阈值与读数之比怎么算。句子与数字格式化都不在这里——
 * 成品由 `signalNotificationSentence.ts` 拼，数字怎么舍入只由平台那一个实现决定。
 */

/** 资产在通知里显示为符号：数据不翻译，但要保证是符号形状。 */
export function signalAssetSymbol(asset: 'btc' | 'eth'): string {
  return asset.toUpperCase()
}

/** 阈值与读数之比：乘除都在这一次算完，文案里不再出现第二个数。 */
export function thresholdMultiple(value: number, threshold: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(threshold) || threshold === 0) return Number.NaN
  return value / threshold
}
