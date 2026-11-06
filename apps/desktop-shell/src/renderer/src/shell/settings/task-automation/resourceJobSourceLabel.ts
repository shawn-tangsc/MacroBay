/**
 * 「来源」这一列 / 下拉项的显示名。
 *
 * 一处实现，两个调用点（表格列、筛选下拉）。以前是两句一模一样的
 * `productNames[productId ?? ''] ?? productId ?? labels.product`，改一处忘一处，
 * 最后两处说法不同——这正是「同一件事两个实现」的老毛病。
 *
 * **拿不到名字时绝不回退产品 id**（契约 v2.41 第三档：系统内部标识任何情况下都不许当文案）。
 * 产品摘要读失败、产品被停用或卸载时，读者看到的是「产品」这样的兜底说法，
 * 而不是 `market-intelligence`。
 */
export function resolveResourceJobSourceName(
  productNames: Readonly<Record<string, string>>,
  productId: string | null | undefined,
  fallback: string
): string {
  const name = productId === null || productId === undefined ? undefined : productNames[productId]
  return name !== undefined && name.trim() !== '' ? name : fallback
}
