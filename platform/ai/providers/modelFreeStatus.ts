import type { ModelDefinition, ModelPricing } from './modelProviderTypes'

/**
 * 价格层面的免费：输入、输出价都为 0。
 *
 * 折扣（`hasDiscount`）**不是**免费：折扣只表示相对标价有优惠，价格本身仍可能非 0，
 * 所以这里不读折扣标记。没有价格数据 ⇒ 不是免费（概念先预设，不报错）。
 */
export function isFreePricedModel(pricing: ModelPricing | undefined): boolean {
  if (!pricing) return false
  return pricing.promptPerMillion === 0 && pricing.completionPerMillion === 0
}

/**
 * 模型是否按免费处理：用户显式标记优先，否则看价格。
 *
 * 唯一实现 —— 模型选择器的「免费」筛选与模型列表的免费徽章都读这里，避免两套口径。
 */
export function isFreeModel(model: Pick<ModelDefinition, 'pricing' | 'freeOverride'>): boolean {
  return model.freeOverride === true || isFreePricedModel(model.pricing)
}
