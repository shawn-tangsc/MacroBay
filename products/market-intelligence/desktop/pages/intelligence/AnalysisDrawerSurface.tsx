import type { ReactNode, Ref } from 'react'
import { X } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { drawerSlidePercent } from './analysisDrawerDrag'
import type { MarketAnalysisDrawerTier } from './MarketAnalysisDashboardLayout'

/**
 * 窄档右缘那张抽屉（最新 AI 结论 + 重点舆情）：**只负责画**。
 *
 * 状态机在 `useAnalysisDrawerDrag`（拖动 / 吸附）与布局（开合、焦点、互斥），这里只把
 * 数据变成一棵树。抽出来的理由很具体：布局文件已经贴着 500 行，判据与呈现再挤在一起就没人敢动。
 *
 * 三条不写在别处的约束：
 * - **位移语义在 `drawerSlidePercent`**：合上 = 100%（在右缘外）、跟手 = 宽 − 位移、开着 = 0。
 *   这里只把它变成一条 CSS，别自己算正负——2026-11-24 真机就是 `translateX(-offset)` 让抽屉
 *   跑到看板左半边、右边漏一条。
 * - 遮罩只负责变暗，**没有关闭动作**（抽屉压在它上面，点不到）；两档统一只有 X 与 Esc。
 * - 把手开着时 `inert`：焦点已经在关闭键上，别再 Tab 回一个被盖住的入口。
 */
export function AnalysisDrawerSurface({ children, closeRef, dragging, edge, gripRef, newsHostRef, offset, onClose, onOpen, open, resolveText, settling, text, tier, width }: Readonly<{
  /** 抽屉正文（两张卡由调用方构造）。 */
  children: ReactNode
  closeRef: Ref<HTMLButtonElement>
  /** 正在跟手拖动：抽屉要看得见、且**不加过渡**。 */
  dragging: boolean
  /** 靠哪一边：只认 `MARKET_ANALYSIS_DRAWER.edge` 一处。 */
  edge: 'left' | 'right'
  gripRef: Ref<HTMLButtonElement>
  newsHostRef: (node: HTMLDivElement | null) => void
  /** 跟手位移（px），0 = 合上。 */
  offset: number
  onClose: () => void
  onOpen: () => void
  open: boolean
  /** 读屏名解析器（由布局注入）：`IconButton` 只收键，句子从文案表取。 */
  resolveText: (key: string) => string
  /** 松手后的 160ms 吸附/回弹：这时才挂过渡。 */
  settling: boolean
  text: Readonly<{ openAnalysisDrawer: string; analysisDrawerTitle: string }>
  /** 并排档（看板让位不了、仍可读）还是整幅档（模态）。 */
  tier: MarketAnalysisDrawerTier
  /** 抽屉宽（并排 454、整幅页宽）：位移百分比按它算。 */
  width: number
}>): React.ReactElement {
  return <>
    {/* 边缘把手：视觉 4px、命中 22×128，竖直居中。整幅档没有热区，只能点它。 */}
    <button aria-label={text.openAnalysisDrawer} className="mi-agent-drawer__grip"
      data-edge={edge}
      inert={open}
      onClick={onOpen}
      ref={gripRef}
      type="button"><i /></button>
    {/* 整幅档的遮罩：只负责变暗。**它没有关闭动作**——抽屉 `width:100%` 且 z 更高，
        压在它上面，点它永远点不到；两档统一只有 X 与 Esc 两条关闭路。
        并排档没有遮罩：看板要能读。 */}
    {open && tier === 'full'
      ? <div aria-hidden="true" className="mi-agent-drawer__scrim" data-analysis-drawer-scrim />
      : null}
    <aside aria-labelledby="mi-analysis-drawer-title" aria-modal={tier === 'full'}
      className="mi-agent-drawer" data-edge={edge}
      data-open={open}
      data-drag={dragging || settling ? 'true' : undefined}
      data-settling={settling ? 'true' : undefined}
      data-tier={tier}
      data-analysis-drawer
      role="dialog"
      /* 从右缘外滑进来：合上 = 100%、跟手 = 宽 − 位移、开着 = 0（语义在 `drawerSlidePercent`）。 */
      style={{ transform: `translateX(${drawerSlidePercent({ offset, width, edge, open })}%)` }}>
      <header className="mi-agent-drawer__head">
        <h2 id="mi-analysis-drawer-title">{text.analysisDrawerTitle}</h2>
        <IconButton ariaLabelKey="pages.intelligence.portal.calendarCard.closeAgent" icon={X} onSelect={onClose} ref={closeRef} resolveText={resolveText} size="md" />
      </header>
      <div className="mi-agent-drawer__body">
        {children}
        {/* 重点舆情：块由 workspace 构造（它拥有选中舆情那份状态），portal 到这里——不是复制一份。 */}
        <div className="mi-agent-drawer__news" data-analysis-news-host ref={newsHostRef} />
      </div>
    </aside>
  </>
}
