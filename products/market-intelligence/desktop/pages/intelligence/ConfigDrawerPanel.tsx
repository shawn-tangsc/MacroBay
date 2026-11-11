import type { ReactElement, ReactNode } from 'react'

import { ErrorBoundary } from '@platform/ui/components/error-boundary'

/**
 * 配置抽屉里「一屏」的面板边界。
 *
 * 为什么要有它（用户 2026-11-11 报的）：抽屉里某一屏渲染崩了，错误态被外层边界接住，落在看板
 * 主列的顶端——那块「读取失败」出现在「最新 AI 结论」之上，读者以为整个看板挂了。崩的其实是
 * 抽屉里的一屏，错误态就该落在那一屏里（抽屉正文），不是页面级。
 *
 * 边界本身仍用平台 `ErrorBoundary`：日志、重试、`StateView` 全归它，这里只做两件事——
 * 1. **一屏一层**：一屏崩了不把别屏一起带走，错误态也只占那一屏的位置；
 * 2. **scope 带前缀**：`config-drawer/<屏>` 进日志与「技术详情」，一眼知道是哪一屏。
 *
 * **文案限制**：平台边界的错误态目前固定是 `error · operation-failed`（「这次操作没有成功」），
 * 没有传产品原因句的入口。要把它改成「这一块没能显示出来」需要平台组件开口子（已报前端组件线），
 * 本文件不自己画一套错误面。
 */
export type ConfigDrawerScreen = 'sources' | 'sourcesData' | 'analysis' | 'briefing' | 'processing' | 'run-log' | 'notifications'

export function ConfigDrawerPanel({ screen, children }: {
  screen: ConfigDrawerScreen
  children: ReactNode
}): ReactElement {
  return <ErrorBoundary scope={`config-drawer/${screen}`}>{children}</ErrorBoundary>
}
