import { Button } from 'antd'
import { Settings2 } from 'lucide-react'

import type { BriefingGenerationProgress } from '../../../contracts/dailyBriefing'
import { BriefingPushToPhoneButton } from './BriefingPushToPhoneButton'
import type { BriefingPushText } from './dailyBriefingPushText'
import type { BriefingPushToPhone } from './useBriefingPushToPhone'
import { DailyBriefingGeneratingStatus } from './DailyBriefingGeneratingStates'
import type { DailyBriefingText } from './dailyBriefingText'
import type { BriefingCopyState, BriefingExportState } from './useBriefingShareActions'

/**
 * The page's one action row.
 *
 * The generate action is always here — an empty or failed page must not force the reader to hunt
 * for it somewhere else — and it is disabled only while a run is in flight or while the failure
 * panel below owns the retry. Kept out of the page: it is a row of controls with its own states,
 * not layout, and the page is a layout.
 */
export function DailyBriefingPageActions({ text, resolveText, progress, loading, generating, regenerating, todayReady, hasTodayEdition, targetDate, zoneInvalid, systemZone, exportable, exportState, copyState, push, pushText, onExport, onCopy, onOpenSettings, onGenerate, onRegenerate }: Readonly<{
  text: DailyBriefingText
  resolveText: (key: string) => string
  progress: BriefingGenerationProgress | undefined
  loading: boolean
  generating: boolean
  regenerating: boolean
  todayReady: boolean
  /** Whether today already has an edition: the label says "generate" or "regenerate" accordingly. */
  hasTodayEdition: boolean
  zoneInvalid: boolean
  systemZone: boolean
  exportable: boolean
  exportState: BriefingExportState
  copyState: BriefingCopyState
  /** The reader's own publication: same group as the generate action, its own words and its own state. */
  push: BriefingPushToPhone
  pushText: BriefingPushText
  onExport: () => void
  onCopy: () => void
  onOpenSettings: () => void
  /** The issue day the action writes: its accessible name says it, so the target is never guessed. */
  targetDate: string
  onGenerate: () => void
  onRegenerate: () => void | Promise<void>
}>): React.ReactElement {
  return <div className="mi-daily-briefing-page__actions">
    {loading ? <DailyBriefingGeneratingStatus progress={progress} resolveText={resolveText} text={text} /> : null}
    {/* The one rule: only a run in flight disables this. Every other state — empty, failed, ready,
        showing a past day, no detail column — keeps it clickable, and its name always says whose
        day it acts on. A disabled control with no reason the reader can see is not allowed. */}
    {/* 期模型之后，这颗按钮只说一件事：现在就按某一期跑一次。旧的「生成或重新生成今天的日报」是
        "整天一条"时代的说法——那时一天只有一份，现在一天可以有多期，重生成要指定是哪一期。 */}
    <Button className="mi-daily-briefing__regenerate" data-toolbar-action="regenerate" disabled={generating}
      /* A run in flight is a wait, so the control shows it is working instead of looking broken. */
      loading={generating}
      {...(generating
        ? { 'aria-label': text.generationProgress.workingHint, title: text.generationProgress.workingHint }
        : { 'aria-label': text.manualGenerateTarget.replace('{date}', targetDate) })}
      onClick={() => { if (todayReady) void onRegenerate(); else onGenerate() }}>
      {regenerating ? text.regenerating : text.manualGenerate}
    </Button>
    {/* Beside the generate action, in the same group: both are about this issue, and a reader who just
        generated is one click from publishing it. Its state lives in the machine, not here — this row
        only places it. */}
    <span className="mi-daily-briefing__push-slot">
      <BriefingPushToPhoneButton state={push.state} text={pushText} onPush={push.onPush} onRetry={push.onRetry} />
      {/* The success sentence is the only thing that appears and leaves on its own. It states what we
          know — handed to the channel — and its timer is its whole lifetime. */}
      {push.sentence === undefined ? null : <span className="mi-daily-briefing__push-toast" role="status">{push.sentence}</span>}
    </span>
    {todayReady ? <>
      {zoneInvalid ? <small className="mi-daily-briefing__clock-note" role="status">{text.generationSettings.manualUtcNote}</small> : null}
      {/* The settings zone was unusable, so the window was computed in the machine's zone. The
          reader configured a time and is getting another day boundary; saying nothing would let
          them read the edition against the wrong one. */}
      {systemZone ? <small className="mi-daily-briefing__clock-note" role="status">{text.timeZoneFromSystem}</small> : null}
    </> : null}
    {exportable ? <Button className="mi-daily-briefing__export" disabled={exportState === 'exporting'} onClick={onExport} aria-live="polite">
      {exportState === 'exporting' ? text.exportingImage : exportState === 'done' ? text.exported : exportState === 'failed' ? text.exportFailed : text.exportImage}
    </Button> : null}
    {exportable ? <Button className="mi-daily-briefing__copy" onClick={onCopy} aria-live="polite">
      {copyState === 'copied' ? text.copied : copyState === 'failed' ? text.copyFailed : text.copy}
    </Button> : null}
    {/* One entry for every brief setting. The icon-only AI-settings trigger that used to sit
        beside it opened a second dialog for half of the same form. */}
    <Button className="mi-daily-briefing__settings-entry" data-briefing-settings-open="true" onClick={onOpenSettings}>
      <Settings2 aria-hidden="true" size={14} />{text.settingsDrawer.open}
    </Button>
  </div>
}
