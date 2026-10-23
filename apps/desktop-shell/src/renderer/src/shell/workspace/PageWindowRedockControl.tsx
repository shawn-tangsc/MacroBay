import { useState } from 'react'
import { Minimize2 } from 'lucide-react'

import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { WorkspaceTabCommandResult } from '@platform/workspace/contracts'
import { platformText } from '../../i18n/platformText'

/**
 * Owner: apps/desktop-shell renderer / workspace 独立**页面窗**的「回停靠」悬浮控件（P2-15）。
 * 权威：P2-09「原生关闭即回停靠」已交付，但页窗**没有可见入口**（用户实测找不到出口）；本控件补上
 * 唯一入口，复用已验证的 `.tabs.redockTab`（**不新增通道 / 不新增 preload 方法**），原生关闭路径不变。
 *
 * 判据（P2-14）：控件必须 `position:absolute`（**引擎内联声明**，不依赖样式表已加载）——页面窗根是
 * `display:grid; grid-template-rows:minmax(0,1fr)`，任何**在流内**的新增子节点都会挤掉正文高度，
 * 因此控件用绝对定位，正文宿主仍是页面窗根的唯一定高在流子节点。
 *
 * 抽取说明（PLAT-02 行数纪律）：本组件自 `WorkspaceWindowRoot.tsx` **原样搬出**（DOM 结构、class、
 * 判据文案、内联样式、相位语义逐字不变），只为把页面窗根压回 500 行以内；行为契约由
 * `workspacePageWindowRedock.test.tsx`（P2-15）与 `workspacePageWindowLayout.test.tsx`（P2-14）取证。
 */

export type PageWindowRedockControlProps = {
  language: AppLanguage
  /** 本页窗的 Tab 身份（`data-redock-tab` 与回停靠命令都只带它）。 */
  workspaceInstanceKey: string
  /** 只有 `detached` 的页窗才有「回停靠」语义；`main`/受理后不再提供入口。 */
  detached: boolean
  /** `.tabs.redockTab` 端口（受控通道的既有出口；本控件绝不自行发命令、绝不重试）。 */
  redockTab: (input: { workspaceInstanceKey: string }) => Promise<WorkspaceTabCommandResult>
}

export function PageWindowRedockControl(props: PageWindowRedockControlProps): React.ReactElement | null {
  const labels = platformText[props.language].workspace
  const [notice, setNotice] = useState<string | null>(null)
  /**
   * 回停靠的本地相位：命令一旦被受理，本窗就**不再**提供可重复点击的入口（Main 随即关闭该死窗，
   * 事件不保证到达页窗 —— 与 P2-07 同一姿态，绝不依赖事件投递来收敛）。被拒则回到 idle，用户仍可重试
   * 或用原生关闭（P2-09 路径不变）。
   */
  const [redockPhase, setRedockPhase] = useState<'idle' | 'pending' | 'accepted'>('idle')

  const redock = (): void => {
    if (redockPhase !== 'idle') return
    setNotice(null)
    setRedockPhase('pending')
    void (async () => {
      try {
        const result = await props.redockTab({ workspaceInstanceKey: props.workspaceInstanceKey })
        // 拒绝必须可见：绝不静默什么都不发生（原生关闭路径仍在，用户不会被困住）
        if (result.status === 'rejected') {
          setNotice(labels.tabCommandRejected)
          setRedockPhase('idle')
          return
        }
        setRedockPhase('accepted')
      } catch {
        setNotice(labels.tabCommandFailed)
        setRedockPhase('idle')
      }
    })()
  }

  // 入口只在「仍是分离态」时存在；相位留在本组件里（组件始终挂载，只有可见性随状态变化）
  if (!props.detached || redockPhase === 'accepted') return null

  return (
    <>
      <button
        type="button"
        className="workspace-page-redock-button"
        data-redock-tab={props.workspaceInstanceKey}
        aria-label={labels.pageWindowRedock}
        title={labels.pageWindowRedock}
        disabled={redockPhase === 'pending'}
        style={{ position: 'absolute', top: 6, right: 6, zIndex: 2 }}
        onClick={redock}>
        <Minimize2 size={13} strokeWidth={1.8} />
      </button>
      {notice === null ? null : (
        <span
          role="status"
          className="workspace-page-redock-notice"
          style={{ position: 'absolute', top: 32, right: 6, zIndex: 2 }}>
          {notice}
        </span>
      )}
    </>
  )
}
