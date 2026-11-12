import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { navigateTo } from '@platform/workspace/navigation/navigationRequest'

import { openBriefingSessionWithShell } from './openBriefingSession'
import type { BriefingPushText } from './dailyBriefingPushText'

/**
 * 页面 → 「发布频道」状态机的输入，只做映射、不判状态。
 *
 * 抽出来的理由只有一条：`DailyBriefingPage.tsx` 已经贴着 500 行，而这十行是**页面事实到发布输入的
 * 翻译**（哪一版、哪种语言、海报从哪张纸来、导读写短去哪），与页面布局无关。
 *
 * 三处判断搬到这里、并在原处留一句：
 * - **发的是屏幕上这一版**：期号取选中项（一日多期时按日期取首行会发错版）；
 * - **海报就是那张纸**：页面只交节点，渲染/判定/字节都在发布那一层，拿不到字节就不调 IPC；
 * - **缩短导读**：只在有编辑会话时给这条路（没有会话就没有能把导读改短的地方）。
 */
export type BriefingPublishInput = Readonly<{
  document: DailyBriefingDocument | undefined
  generating: boolean
  localeMissing: boolean
  periodId: string
  text: BriefingPushText
  refreshKey: number
  posterRoot: () => HTMLElement | null
  onShortenLede?: (() => void) | undefined
  /** 一条可用通道都没有时那条路：去频道页。 */
  onOpenChannels: () => void
}>

export function briefingPublishInputs(input: Readonly<{
  document: DailyBriefingDocument | undefined
  generating: boolean
  localeMissing: boolean
  periodId: string
  text: BriefingPushText
  refreshKey: number
  posterRoot: () => HTMLElement | null
  /** 屏幕上这一版的编辑会话；没有它就不给「缩短导读」那颗按钮。 */
  sessionId?: string | undefined
}>): BriefingPublishInput {
  const sessionId = input.sessionId
  return {
    document: input.document,
    generating: input.generating,
    localeMissing: input.localeMissing,
    periodId: input.periodId,
    text: input.text,
    refreshKey: input.refreshKey,
    posterRoot: input.posterRoot,
    ...(sessionId === undefined
      ? {}
      : { onShortenLede: () => { void openBriefingSessionWithShell(sessionId) } }),
    // 「去频道」：零通道那条结果的唯一动作。导航归壳，这里只给那一处目的地。
    onOpenChannels: () => navigateTo({ page: 'settings', panel: 'channels' })
  }
}
