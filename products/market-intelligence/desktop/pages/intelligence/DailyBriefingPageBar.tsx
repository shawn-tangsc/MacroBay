import { Button } from 'antd'
import { ArrowLeft } from 'lucide-react'

import type { BriefingGenerationProgress } from '../../../contracts/dailyBriefing'
import { DailyBriefingPageActions } from './DailyBriefingPageActions'
import type { BriefingManualRunDraft } from './BriefingManualRunDialog'
import type { BriefingManualRunOutcome } from './useBriefingManualRun'
import type { DailyBriefingText } from './dailyBriefingText'

/**
 * 日报页的页面顶栏（吸顶）：返回看板 + 页面级的两颗动作。
 *
 * 只是把页面里那段 JSX 搬到这里，**一个值都没改**：同样的类名、同样的顺序、同样的 props。
 * 抽出来是因为页面文件已经顶到体积门禁（503 行），而这段与页面状态无关——它拿到的全是现成值。
 */
export function DailyBriefingPageBar({
  text,
  resolveText,
  progress,
  loading,
  generating,
  regenerating,
  runningLabel,
  todayReady,
  targetDate,
  zoneInvalid,
  systemZone,
  onManualRun,
  onOpenSettings,
  onBack
}: Readonly<{
  text: DailyBriefingText
  resolveText: (key: string) => string
  progress: BriefingGenerationProgress | undefined
  loading: boolean
  generating: boolean
  regenerating: boolean
  /** 手动那一期在写时的按钮文案（含时刻与语言）；缺省沿用「正在重新生成…」。 */
  runningLabel?: string
  todayReady: boolean
  targetDate: string
  zoneInvalid: boolean
  systemZone: boolean
  onManualRun: (draft: BriefingManualRunDraft) => Readonly<{
    outcome: BriefingManualRunOutcome
    duplicate?: Readonly<{ label: string; replace: () => void }>
  }>
  onOpenSettings: () => void
  onBack: () => void
}>): React.ReactElement {
  return <header className="mi-daily-briefing-page__bar">
    <Button className="mi-daily-briefing-page__back" onClick={onBack}>
      <ArrowLeft aria-hidden="true" size={15} />{text.backToDashboard}
    </Button>
    {/* 页面顶只留两颗：今天出不出（手动生成）、日报设置。版次级那五颗在正文区顶部。 */}
    <DailyBriefingPageActions
      text={text}
      resolveText={resolveText}
      progress={progress}
      loading={loading}
      generating={generating}
      regenerating={regenerating}
      {...(runningLabel === undefined ? {} : { runningLabel })}
      todayReady={todayReady}
      targetDate={targetDate}
      zoneInvalid={zoneInvalid}
      systemZone={systemZone}
      onManualRun={onManualRun}
      onOpenSettings={onOpenSettings}
    />
  </header>
}
