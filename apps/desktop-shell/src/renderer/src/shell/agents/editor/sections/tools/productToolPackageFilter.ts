import type { ProductAgentToolPackageEditorView } from '@platform/ai/agent-platform/productTools/productAgentToolViewModel'
import type { LocalizedText } from '@platform/product-manifest'

export type VisibleProductToolPackage = {
  package: ProductAgentToolPackageEditorView
  productName?: LocalizedText
  /** 该产品在这张卡里实际展示的工具：搜索命中产品本身时是全部，否则只留命中的工具。 */
  tools: ProductAgentToolPackageEditorView['tools']
  /** true 表示列表被搜索收窄过，界面据此跳过折叠。 */
  filtered: boolean
}

/**
 * 产品工具包的搜索入口：产品名 / 产品 id / 工具标题 / 工具名 / 诊断文本都可命中。
 * 命中产品本身时展示它全部工具；只命中工具时只展示命中的工具，避免 30 行里找那一行。
 */
export function filterProductToolPackages(
  packages: readonly ProductAgentToolPackageEditorView[],
  productNames: Readonly<Record<string, LocalizedText>>,
  search: string
): VisibleProductToolPackage[] {
  const query = search.trim().toLowerCase()
  const visible: VisibleProductToolPackage[] = []

  for (const pkg of packages) {
    const productName = productNames[pkg.productId]
    const tools = [...pkg.tools].sort((left, right) => left.toolName.localeCompare(right.toolName))

    if (!query) {
      visible.push({ package: pkg, productName, tools, filtered: false })
      continue
    }

    const productMatches =
      matches(pkg.productId, query) ||
      matches(productName?.['zh-CN'], query) ||
      matches(productName?.['en-US'], query) ||
      pkg.diagnostics.some((entry) => matches(entry, query))

    if (productMatches) {
      visible.push({ package: pkg, productName, tools, filtered: false })
      continue
    }

    const matchingTools = tools.filter(
      (tool) =>
        matches(tool.toolName, query) ||
        matches(tool.title?.['zh-CN'], query) ||
        matches(tool.title?.['en-US'], query)
    )
    if (matchingTools.length > 0) {
      visible.push({ package: pkg, productName, tools: matchingTools, filtered: true })
    }
  }

  return visible
}

function matches(value: string | undefined, query: string): boolean {
  return Boolean(value && value.toLowerCase().includes(query))
}
