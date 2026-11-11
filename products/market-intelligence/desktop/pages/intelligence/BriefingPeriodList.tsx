import { CircleHelp, Pencil, Trash2 } from 'lucide-react'

import { InlineNotice } from '@platform/ui/components/inline-notice'
import { IconButton } from '@platform/ui/components/icon-button'
import { LoadingState } from '@platform/ui/components/loading'
import { Popover } from '@platform/ui/components/popover'
import { SettingsRow } from '@platform/ui/components/settings-row'

import type { BriefingPeriod } from '../../../contracts/dailyBriefingPeriod'
import type { DailyBriefingText } from './dailyBriefingText'

/**
 * 「生成」区块里的期列表：读失败 / 读中 / 空态 / 一期一行，四态各自说自己的事。
 *
 * 抽出来的理由是屏已经过了 500 行的门禁——这一块有自己的四态判断和两颗行尾按钮，是屏里最独立的一段；
 * 抽出来不改任何 DOM：类名、`data-*`、可访问名、行尾按钮的兄弟关系全部原样，只是把参数收成一份。
 * ⚠ 空态那句话进 ⓘ（说明句不进正文），这条 `check:body-prose` 看着。
 */
const EDIT_KEY = 'pages.intelligence.portal.dashboard.dailyBriefing.settings.periods.editRow'
const DELETE_KEY = 'pages.intelligence.portal.dashboard.dailyBriefing.settings.periods.deleteRow'
const RETRY_KEY = 'pages.intelligence.portal.dashboard.dailyBriefing.settings.periods.retryLoad'
const EMPTY_HINT_KEY = 'pages.intelligence.portal.dashboard.dailyBriefing.settings.periods.emptyHint'

export function BriefingPeriodList({ periods, periodsFailed, copy, resolveText, languageName, onRetry, onEdit, onRemove }: Readonly<{
  /** `null` 是「还没读到」；`[]` 是「确实一期都没有」——两件事，不共用同一个空态。 */
  periods: readonly BriefingPeriod[] | null
  periodsFailed: boolean
  copy: DailyBriefingText['settings']['periods']
  resolveText: (key: string) => string
  languageName: (locale: string) => string
  onRetry: () => void
  onEdit: (period: BriefingPeriod) => void
  onRemove: (period: BriefingPeriod, index: number) => void
}>): React.ReactElement {
  if (periodsFailed) {
    return <InlineNotice
      action={{ labelKey: RETRY_KEY, onSelect: onRetry }}
      resolveText={resolveText}
      tone="danger">
      {copy.loadFailed}
    </InlineNotice>
  }
  if (periods === null) return <LoadingState label={copy.loading} minHeight={90} />
  if (periods.length === 0) {
    return <div className="briefing-settings-empty" data-briefing-periods-empty="true">
      <p>{copy.empty}</p>
      {/* 说明句进 ⓘ：正文只留「没有一期」这个事实，不铺解释。 */}
      <Popover
        labelKey={EMPTY_HINT_KEY}
        resolveText={resolveText}
        trigger={(triggerProps) => <IconButton
          {...triggerProps}
          ariaLabelKey={EMPTY_HINT_KEY}
          icon={CircleHelp}
          resolveText={resolveText}
          size="sm"
          variant="plain"
        />}
      />
    </div>
  }
  return <>{periods.map((period, index) => <SettingsRow
    copyClassName="config-drawer__label"
    controlWrapperClassName="config-drawer__control"
    key={period.id}
    label={<strong>{copy.label.replace('{index}', String(index + 1))}</strong>}
    rowAttributes={{ 'data-period-id': period.id }}
    rowClassName="config-drawer__row">
    <span className="briefing-settings-row__value">
      {copy.timeValue.replace('{time}', period.generationTime)}
      {' · '}
      {copy.windowValue.replace('{hours}', String(period.windowHours))}
      {' · '}
      {languageName(period.language)}
    </span>
    <span className="briefing-settings-row__actions">
      <IconButton
        ariaLabelKey={EDIT_KEY}
        ariaLabelParams={{ index: String(index + 1) }}
        dataAttributes={{ 'data-period-edit': period.id }}
        icon={Pencil}
        onSelect={() => onEdit(period)}
        resolveText={(key) => key === EDIT_KEY ? copy.editRow.replace('{index}', String(index + 1)) : ''}
        size="sm"
        variant="plain"
      />
      <IconButton
        ariaLabelKey={DELETE_KEY}
        ariaLabelParams={{ index: String(index + 1) }}
        dataAttributes={{ 'data-period-delete': period.id }}
        icon={Trash2}
        onSelect={() => onRemove(period, index)}
        resolveText={(key) => key === DELETE_KEY ? copy.deleteRow.replace('{index}', String(index + 1)) : ''}
        size="sm"
        variant="plain"
      />
    </span>
  </SettingsRow>)}</>
}
