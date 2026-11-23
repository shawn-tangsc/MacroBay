import type { Ref } from 'react'

import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { DailyBriefingShareCard } from './DailyBriefingShareCard'
import type { posterProps } from './dailyBriefingPoster'
import {
  briefingChangeArrows,
  briefingFearGreedBuckets,
  briefingPaymentDirections,
  briefingPolicyGaugeWords
} from './dailyBriefingPaymentDirections'
import './dailyBriefingShareCard.css'

/**
 * 导出的那一张纸：离屏节点，屏幕上不画，只用来画图（页面截图导出、海报窗口、推图）。
 *
 * 它自己一个文件，是为了让「导出面」在代码里也只有一个形状：正文说明句门禁的截图面名单
 * （`scripts/check-body-prose.mts` 的 `CAPTURE_ONLY_SURFACES`）按**文件**认导出面，这条从页面
 * 里抽出来之前，同样的离屏节点挤在可见页文件里，既认不出来、也永远清不掉那行基线。
 *
 * 豁免的理由**不是**「读者看不见」——这张图会被存档、转发、被不相干的人读到。理由是**产物形态**：
 * PNG 里没有 `ⓘ`、没有 hover，也没有可以省下来的屏幕空间；图上的那句话是内容（这一版缺不缺数据、
 * 有没有另一种语言版），读者要靠它判断这份简报全不全。
 *
 * 图上每个字都**不许在这里写**：文案与那句完整性说明一律来自 `posterProps`，
 * 这里只往下传。写第二份就会和页面上的那句走散，而两者本来就该是同一句。
 */
export type DailyBriefingShareHostProps = Readonly<{
  document: DailyBriefingDocument
  /** `posterProps` 的结果：文案、语言、以及不完整时那一句。这里不选语言、不拼句子。 */
  poster: ReturnType<typeof posterProps>
  readOnly?: boolean
  eventTitles?: Record<string, string>
  formatTime: (value: string, precision?: 'minute' | 'second') => string
  /** 读者时区：图上的时刻与时区必须来自同一处。 */
  timeZone: string
  /** 导出器要的那块 DOM：调用方自己拿着 ref，位置不变（仍在卡片外面这一层）。 */
  ref?: Ref<HTMLDivElement>
}>

export function DailyBriefingShareHost({
  document,
  poster,
  readOnly = false,
  eventTitles,
  formatTime,
  timeZone,
  ref
}: DailyBriefingShareHostProps): React.ReactElement {
  const locale = poster.locale
  return <div className="mi-daily-briefing-share-host" aria-hidden="true">
    {/* The exported node only: rows that are just a fallback reading stay on the page above. */}
    <div ref={ref}><DailyBriefingShareCard
      document={document}
      text={poster.text}
      locale={locale}
      readOnly={readOnly}
      paymentDirectionsCompact={briefingPaymentDirections(locale)}
      policyWords={briefingPolicyGaugeWords(locale)}
      changeArrows={briefingChangeArrows(locale)}
      fearGreedBuckets={briefingFearGreedBuckets(locale)}
      {...(poster.completenessNote === undefined ? {} : { completenessNote: poster.completenessNote })}
      {...(eventTitles === undefined ? {} : { eventTitles })}
      formatTime={formatTime}
      timeZone={timeZone}
    /></div>
  </div>
}