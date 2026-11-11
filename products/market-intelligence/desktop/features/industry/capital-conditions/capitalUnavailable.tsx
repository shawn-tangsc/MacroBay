import type { DashboardCapitalConditionsUnavailableReason } from './capitalConditionsModel'
import { isCapitalConditionsRetryable } from './capitalConditionsModel'

/**
 * 「整卡读不到」这一步的两块零件：**那一行要说什么**，以及**空表里的一行长什么样**。
 *
 * 抽出来是因为 `CapitalConditionsPanel.tsx` 已经贴着 500 行的体积门禁：这张卡的可用态本身很重，
 * 读不到那一支的句子/动作选择与骨架行不该挤在同一个文件里。
 */

/** 整卡读不到时，表头下面第一行要说的东西：一句状态 + 一颗动作。 */
export type UnavailableNotice = Readonly<{ sentence: string; action: string; onAction: () => void }>

type NoticeText = Readonly<{ contractMismatch: string; refresh: string }>

/**
 * 句子与动作按**成因**分（`f6cded2` 的那条界线不许退回去）：
 * 版本/形状不符不是「再试一次」能解决的，唯一出口是重启应用；其余给重试或再采集。
 */
export function unavailableNotice(
  reason: DashboardCapitalConditionsUnavailableReason,
  text: NoticeText,
  dataText: (key: string) => string,
  restartLabel: string,
  onRefresh: () => void
): UnavailableNotice {
  const unreadable = dataText('pages.intelligence.portal.data.temporarilyUnavailable')
  if (reason === 'contract-mismatch') {
    return { sentence: text.contractMismatch, action: restartLabel, onAction: () => { void window.platform.app.relaunch() } }
  }
  return isCapitalConditionsRetryable(reason)
    ? { sentence: unreadable, action: dataText('pages.intelligence.portal.data.retry'), onAction: onRefresh }
    : { sentence: unreadable, action: text.refresh, onAction: onRefresh }
}

/**
 * 整卡读不到时的一行：**行名与图例点照旧，数据格留空**。
 *
 * 不写「未知」也不写 `—`：前者是「这一支缺值」的说法（另一支有数时才用），后者是「确实没有」；
 * 整卡没读到的时候，两种说法都在撒谎。
 */
export function SkeletonEtfRow({ label, series, span }: { label: string; series: 'btc' | 'eth'; span: number }): React.ReactElement {
  // 数据列：最近一日 + 每个累计窗口 + 连续天数，全部留空（`span` 是第一列之外的所有列）。
  const cells = Array.from({ length: Math.max(span - 1, 0) }, (_, index) => <td key={index} />)
  return <tr data-etf-skeleton={series}>
    <th scope="row">
      <i aria-hidden="true" className="mi-capital-conditions__asset-dot" data-series={series} />
      {label}
    </th>
    {cells}
  </tr>
}
