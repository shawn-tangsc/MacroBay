import { Button } from 'antd'

import type { DailyBriefingText } from './dailyBriefingText'
import type { editorialNotice } from './dailyBriefingEditorialNotice'

/**
 * 没有 AI 解读的那一期在页面上说的那句话（r17）：一句说明 + 一个动作。
 *
 * 三种情形、三种动作：去配置 / 重新生成 / 什么都不给（等额度）。第三种刻意没有按钮——
 * 点了也还是没额度，多一颗只会让人以为坏了。
 */
export function BriefingEditorialNotice({ notice, text, regenerating, onOpenSettings, onRetry }: Readonly<{
  notice: NonNullable<ReturnType<typeof editorialNotice>>
  text: DailyBriefingText
  regenerating: boolean
  onOpenSettings: () => void
  onRetry: () => void
}>): React.ReactElement {
  return <p className="mi-daily-briefing-page__ai-failure" role="status" data-editorial-notice={notice.case}>
    <span>{notice.sentence}</span>
    {notice.action === 'configure'
      ? <Button type="link" size="small" data-editorial-notice-action="configure" onClick={onOpenSettings}>{text.aiSettings.noticeAction.configure}</Button>
      : notice.action === 'regenerate'
        ? <Button type="link" size="small" data-editorial-notice-action="regenerate" disabled={regenerating} onClick={onRetry}>{text.aiSettings.noticeAction.regenerate}</Button>
        : null}
  </p>
}
