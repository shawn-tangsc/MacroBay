import type { SendStatusCopy } from './analysisConclusionSendCopy'

import './analysisConclusionSend.css'

/**
 * 标题行下方那条说明行（定稿：muted、`role="status"`、**只在有结果时出现**、不弹 toast）。
 *
 * 两条规矩：
 * - **发送中不出现**：按钮自己已经转着圈说「正在发送」，同一件事不设两个等待指示。
 * - **原因码只在这一个折叠区**：默认收起，展开后恰好一处；没有码就不渲染这个折叠项，
 *   不拿空壳占位，也不把码写进主句。
 */
export function AnalysisConclusionSendStatus(props: Readonly<{
  status: SendStatusCopy
  reasonLabel: string
}>): React.ReactElement {
  return <div className="mi-analysis-send__status-row">
    <p className="mi-analysis-send__status" role="status">{props.status.message}</p>
    {props.status.reasonCode === undefined ? null : <details className="mi-analysis-send__reason">
      <summary>{props.reasonLabel}</summary>
      <code>{props.status.reasonCode}</code>
    </details>}
  </div>
}
