import { isFreePricedModel } from './modelFreeStatus'
import type { ModelDefinition, ModelPriceTag } from './modelProviderTypes'

/**
 * 自动判定价格档位（各厂商差异都在上游归一，这里只认归一后的价格）：
 * - 手动标记免费 ⇒ `free`；
 * - 输入、输出价都为 0 ⇒ `free`（OpenRouter 等用 0 价表示免费）；
 * - 有折扣标记 ⇒ `discount`（折扣仍收费，不是免费）；
 * - 其余 ⇒ `paid`。
 */
export function deriveModelPriceTag(
  model: Pick<ModelDefinition, 'pricing' | 'freeOverride'>
): ModelPriceTag {
  if (model.freeOverride === true) return 'free'
  if (isFreePricedModel(model.pricing)) return 'free'
  if (model.pricing?.hasDiscount === true) return 'discount'
  return 'paid'
}

/**
 * 读取归一后的价格档位：**持久化字段优先**（保存/同步/加载边界已用 `deriveModelPriceTag`
 * 写过），老数据没有该字段时现场回退，保证 UI 不出现空白。
 */
export function resolveModelPriceTag(
  model: Pick<ModelDefinition, 'pricing' | 'freeOverride' | 'priceTag'>
): ModelPriceTag {
  if (model.freeOverride === true) return 'free'
  return model.priceTag ?? deriveModelPriceTag(model)
}

/** 写回归一字段；其它字段原样保留。 */
export function withModelPriceTag<T extends Pick<ModelDefinition, 'pricing' | 'freeOverride'>>(
  model: T
): T & { priceTag: ModelPriceTag } {
  return { ...model, priceTag: deriveModelPriceTag(model) }
}
