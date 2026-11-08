import { Info } from 'lucide-react'

import { Drawer } from '@platform/ui/components/drawer'
import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import type { MarketAnalysisTimelineEntry } from '../../shared/ipc/marketAnalysisTimelineClient'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import { AnalysisConclusionSendButton } from './AnalysisConclusionSendButton'
import { AnalysisConclusionSendStatus } from './AnalysisConclusionSendStatus'
import { analysisConclusionSendText } from './analysisConclusionSendText'
import { useAnalysisConclusionSend } from './useAnalysisConclusionSend'
import type { MarketAnalysisTimelineText } from './MarketAnalysisTimeline'
import { TimelinePanel } from './TimelinePanel'
import type { UseMarketAnalysisTimelineResult } from './useMarketAnalysisTimeline'

/**
 * The analysis timeline moved out of the right column; the conclusion card is its entry.
 *
 * The head, the close control, the mask, Escape and focus return are the shared drawer's: this used
 * to suppress all of them and hand-draw its own header, which is how a dialog ends up with no mask
 * and a close button nobody else had.
 *
 * The send action sits in the drawer's own `actions` slot (right end, left of the close control) and
 * the explaining ⓘ beside the title (`titleExtra`): one head gets one action, and the platform owns
 * both the 12px gap and the rule that a long title truncates before the action moves.
 */
const INFO_KEY = 'pages.intelligence.portal.analysisTimeline.sendInfo'
const INFO_LABEL_KEY = 'pages.intelligence.portal.analysisTimeline.sendInfoLabel'

export function AnalysisTimelineDrawer(props: {
  open: boolean
  text: MarketAnalysisTimelineText
  timeline: UseMarketAnalysisTimelineResult
  openEntry?: MarketAnalysisTimelineEntry
  onOpenChange: (entry: MarketAnalysisTimelineEntry | undefined) => void
  onClose: () => void
}): React.ReactElement {
  const resolveProductText = useProductTextKey()
  const language = useShellLanguage()
  const formatTime = useShellTimeFormat()
  const sendText = analysisConclusionSendText(language)
  // 最新那条带分析运行的条目：时间轴按时间倒序，第一条带 run id 的就是「最新那条结论」。
  // 条件写「有运行」而不是「有通知记录」——手动跑出来的结论从来没有通知记录，照样可以发。
  const latest = props.timeline.state.entries.find((entry) => entry.analysisRunId !== null)
  const { phase, send } = useAnalysisConclusionSend({
    text: sendText,
    analysisRunId: latest?.analysisRunId ?? undefined,
    // 时刻按读者时区格式化（平台那一份），不拿本机时间凑。
    formatNow: () => formatTime(new Date().toISOString(), 'minute')
  })
  const infoResolver = (key: string): string => {
    if (key === INFO_KEY) return sendText.infoHint
    if (key === INFO_LABEL_KEY) return sendText.infoLabel
    return resolveProductText(key)
  }
  return <Drawer
    actions={<AnalysisConclusionSendButton
      disabled={latest === undefined}
      onSelect={() => void send()}
      sending={phase.kind === 'sending'}
      text={sendText}
    />}
    className="mi-analysis-timeline-drawer"
    destroyOnHidden
    mode="modal"
    onClose={props.onClose}
    open={props.open}
    resolveText={resolveProductText}
    size="large"
    titleExtra={<Popover
      labelKey={INFO_KEY}
      resolveText={infoResolver}
      trigger={(triggerProps) => <IconButton
        {...triggerProps}
        ariaLabelKey={INFO_LABEL_KEY}
        icon={Info}
        resolveText={infoResolver}
        size="sm"
        variant="plain"
      />}
    />}
    titleKey="pages.intelligence.portal.analysisDrawer.title">
    {/* 结果只在标题下方这一行说：不弹 toast，也不拿按钮的状态冒充回执。 */}
    {phase.kind === 'result' ? <AnalysisConclusionSendStatus reasonLabel={sendText.reasonLabel} status={phase.status} /> : null}
    <TimelinePanel
      onOpenChange={props.onOpenChange}
      openEntry={props.openEntry}
      text={props.text}
      timeline={props.timeline}
    />
  </Drawer>
}
