import {
  MARKET_ANALYSIS_IPC_METHODS,
  type NewsInterpretationReadResult
} from '../../../contracts/marketAnalysisIpcContracts'

const PRODUCT_ID = 'market-intelligence'

/** 只读结果的三种真话 + 一种「这次没读到」：后者不冒充 none（那是「确实没有解读」）。 */
export type NewsInterpretationReadView =
  | NewsInterpretationReadResult
  | Readonly<{ state: 'unreadable'; itemId: string }>

/**
 * 按条「AI 解读」的只读客户端（R37）。
 *
 * 只做一件事：这条新闻当前有没有已有解读、它的证据指纹与此刻是否一致——决定菜单显示
 * 「查看 AI 解读」还是「再次解读」。写端点（`requestNewsInterpretation`）下一笔再接，
 * 这里**没有**任何触发分析的方法，免得读者点到一个会报未知方法的中间态。
 */
export const newsInterpretationClient = {
  async read(itemId: string): Promise<NewsInterpretationReadView> {
    try {
      if (!window.platform?.products?.invoke) return { state: 'unreadable', itemId }
      const result = await window.platform.products.invoke(
        PRODUCT_ID,
        MARKET_ANALYSIS_IPC_METHODS.readNewsInterpretation,
        { itemId }
      ) as NewsInterpretationReadResult
      if (result === null || typeof result !== 'object' || result.itemId !== itemId) return { state: 'unreadable', itemId }
      if (result.state !== 'none' && result.state !== 'available' && result.state !== 'in-flight') {
        return { state: 'unreadable', itemId }
      }
      return result
    } catch {
      return { state: 'unreadable', itemId }
    }
  }
}

/** 已有解读的正文：走既有的 `marketAnalysis.getSummary`，不新开读取路径。 */
export async function readInterpretationSummary(summaryId: string): Promise<readonly string[] | undefined> {
  try {
    if (!window.platform?.products?.invoke) return undefined
    const summary = await window.platform.products.invoke(
      PRODUCT_ID,
      MARKET_ANALYSIS_IPC_METHODS.getSummary,
      { id: summaryId }
    ) as { conclusion?: { summary?: unknown; change?: unknown; causalChain?: unknown } } | null
    const conclusion = summary?.conclusion
    if (conclusion === undefined || conclusion === null) return undefined
    return [conclusion.summary, conclusion.change, conclusion.causalChain]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  } catch {
    return undefined
  }
}

export type NewsInterpretationClient = typeof newsInterpretationClient
