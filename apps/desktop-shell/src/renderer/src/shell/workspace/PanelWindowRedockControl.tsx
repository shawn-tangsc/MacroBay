import { useRef, useState } from 'react'
import { Minimize2 } from 'lucide-react'

import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { WorkspacePanelResult } from '@platform/workspace/contracts'
import { platformText } from '../../i18n/platformText'

/**
 * Owner: apps/desktop-shell renderer / workspace（**PLAT-40**）。
 *
 * 分离**面板窗**顶栏的「回停靠」入口。缺陷：面板窗此前没有任何回停靠入口 —— 面板 store 的
 * `switchContainer` 明确拒绝 `detached → 非 detached`，只有原生 X（`handleNativeClose`）会开转移事务。
 *
 * 形态（**不新增通道 / 不新增 preload 方法**）：复用既有 `workspace.command` 通道的受控方法
 * `redockPanel`（身份由 Main 从 `event.sender` + registry 推导，renderer 只给 `panelInstanceKey`；
 * 目标停靠模式由 Main 按 `lastValidDock` + 受支持模式收敛）。原生 X 路径**逐字不变**。
 *
 * 相位语义与页窗控件同构（P2-15）：受理后本窗不再提供可重复点击的入口（Main 随即销毁该窗，事件不保证
 * 到达）；被拒/失败则回到 idle 并给出可见提示，用户仍可用原生 X 回停靠。
 * 在飞守卫用 ref（同步）而非仅 state：同一帧内的重复点击绝不会发出第二条命令（state 会被 React 批处理）。
 */
export type PanelWindowRedockControlProps = {
  language: AppLanguage
  /** 本面板窗唯一承载的面板实例键（`data-redock-panel` 与命令都只带它）。 */
  panelInstanceKey: string
  /** 受控回停靠端口；缺失即视为能力不支持（本控件绝不自行发命令/重试/伪造成功）。 */
  redock?: (input: { panelInstanceKey: string }) => Promise<WorkspacePanelResult>
}

export function PanelWindowRedockControl(props: PanelWindowRedockControlProps): React.ReactElement | null {
  const labels = platformText[props.language].workspace
  const [notice, setNotice] = useState<string | null>(null)
  const [phase, setPhase] = useState<'idle' | 'pending' | 'accepted'>('idle')
  const inFlight = useRef(false)

  const redock = (): void => {
    if (inFlight.current || props.redock === undefined) return
    inFlight.current = true
    setNotice(null)
    setPhase('pending')
    void (async () => {
      try {
        const result = await props.redock?.({ panelInstanceKey: props.panelInstanceKey })
        // 端口在 await 期间被卸载/替换时不做任何状态写入（绝不制造幽灵成功）
        if (result === undefined) { inFlight.current = false; setPhase('idle'); return }
        if (result.status === 'rejected') {
          setNotice(labels.panelWindowRedockFailed)
          setPhase('idle')
          inFlight.current = false
          return
        }
        setPhase('accepted')
      } catch {
        setNotice(labels.panelWindowRedockFailed)
        setPhase('idle')
        inFlight.current = false
      }
    })()
  }

  if (props.redock === undefined || phase === 'accepted') return null

  return (
    <>
      <button
        type="button"
        className="workspace-page-redock-button"
        data-redock-panel={props.panelInstanceKey}
        aria-label={labels.panelWindowRedock}
        title={labels.panelWindowRedock}
        disabled={phase === 'pending'}
        onClick={redock}>
        <Minimize2 size={13} strokeWidth={1.8} />
      </button>
      {notice === null ? null : (
        <span role="status" className="workspace-page-redock-notice" data-redock-notice={props.panelInstanceKey}>
          {notice}
        </span>
      )}
    </>
  )
}
