import { createElement } from 'react'

import { dashboardCellId } from './dashboardCellEnabled'
import type { CellReadDecision } from './dashboardCellEnabled'
import type { PolicyPathReadResult } from '../../shared/ipc/policyPathClient'
import { PolicyPathCard, PolicyPathUnavailable } from './PolicyPathCard'
import { policyPathMonth } from './policyPathMonth'
import type { productText } from '../../shared/i18n/productText'

type PolicyPathText = typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']['dashboard']['policyPath']

/**
 * 政策路径那一格的五种形态，逐支点名（架构师 2026-11-12 批的**同模块双格**形状）：
 *
 * 1. 两格都去读 → 正常画；读失败仍是「读不到 + 再试一次」（不冒充「没启用」）；
 * 2. 只关「政策路径概率」→ 点这一格，不提美联储；
 * 3. 只关「美联储日程」→ 点这一格——赔率是读到的，画不出路径不是它的错；
 * 4. 两格都关 → **一句同时点名两格** + 去设置（不拆两条缺项）；
 * 5. 某一格的**源**自己关着（`source-disabled`）→ 说源的名字，不说成「这一格没启用」。
 *
 * 搬出主文件只为控体积；判定仍全部来自宿主传进来的 `decideCellRead` 结果。
 */
export function PolicyPathSlot({ text, locale, decisions, read, onConfigureSources, onFocusCell, onOpenDetail, resolveKey }: Readonly<{
  text: PolicyPathText
  locale: 'zh-CN' | 'en-US'
  decisions: Readonly<{ probability: CellReadDecision; fed: CellReadDecision }>
  read: Readonly<{ result?: PolicyPathReadResult; reload: () => void }>
  onConfigureSources: () => void
  onFocusCell: (cellKey: 'probability' | 'fed') => void
  onOpenDetail: () => void
  /** 产品文案解析（源显示名等）：由宿主给，组件不自建第二套文案表。 */
  resolveKey?: (key: string) => string
}>): React.ReactElement {
  const key = resolveKey ?? (() => '')
  const reading = read.result
  const bothRead = decisions.probability.kind === 'read' && decisions.fed.kind === 'read'
  const sourceOff = [decisions.probability, decisions.fed].find(decision => decision.kind === 'source-disabled')
  const offCells = [
    ...(decisions.probability.kind === 'read' ? [] : ['probability' as const]),
    ...(decisions.fed.kind === 'read' ? [] : ['fed' as const])
  ]
  const disabledCell = (sentence: string, cellKey: 'probability' | 'fed'): React.ReactElement =>
    <PolicyPathUnavailable state="disabled" text={text} sentence={sentence}
      action={{ label: key('pages.intelligence.portal.data.enableSources'), run: () => onFocusCell(cellKey) }} />

  if (bothRead) {
    return reading?.state === 'available'
      ? <PolicyPathCard reading={reading.reading} text={text}
          month={policyPathMonth(reading.reading.meetingDate, locale)} onOpen={onOpenDetail} />
      : <PolicyPathUnavailable state="unreadable" text={text} onRetry={read.reload} />
  }
  // 5) 源自己关着：点它落到**这一格**（这一格开着，读者要开的是源）。
  if (sourceOff !== undefined && sourceOff.kind === 'source-disabled') {
    return <PolicyPathUnavailable state="disabled" text={text}
      sentence={text.dependencySourceOff.replace('{source}', key(`settings.intelligenceSources.sourceNames.${sourceOff.sourceId}`))}
      action={{ label: key('pages.intelligence.portal.data.enableSources'), run: () => onFocusCell(decisions.fed.kind === 'read' ? 'probability' : 'fed') }} />
  }
  // 4) 两格都关：一句话同时点名两格。
  if (offCells.length === 2) {
    return <PolicyPathUnavailable state="disabled" text={text} sentence={text.bothCellsOff}
      action={{ label: key('pages.intelligence.portal.data.configureSources'), run: onConfigureSources }} />
  }
  // 2) / 3) 只缺一格：点这一格。
  return offCells[0] === 'probability'
    ? disabledCell(text.probabilityCellOff, 'probability')
    : disabledCell(text.fedCellOff, 'fed')
}
