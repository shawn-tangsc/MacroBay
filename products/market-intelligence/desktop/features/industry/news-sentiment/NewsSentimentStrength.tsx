import { tierOf } from '../../../../contracts/newsSentimentTiers'

import type { NewsSentimentText } from './NewsSentimentCard'

/**
 * 档位阈值**不在这里**：它住 `contracts/newsSentimentTiers.ts`，推送判据调的是同一个函数。
 * 这里只把档位翻成读者看得见的词（低 / 中 / 高）——与手机标题、设置页那一行同一套。
 */
export function strengthLabel(text: NewsSentimentText, strength: number): string {
  const levels = text.drawer.detail.strengthLevels
  const tier = tierOf(strength)
  if (tier === 'low') return levels.weak
  if (tier === 'high') return levels.strong
  return levels.medium
}

export function NewsSentimentStrength(props: {
  strength: number
  text: NewsSentimentText
  compact?: boolean
}): React.ReactElement {
  return (
    <span
      aria-label={`${props.text.drawer.detail.strength} ${props.strength}/5 · ${strengthLabel(props.text, props.strength)}`}
      className={`mi-news-strength${props.compact ? ' is-compact' : ''}`}
    >
      <em>{props.text.drawer.detail.strength}</em>
      {[1, 2, 3, 4, 5].map((level) => (
        <i className={level <= props.strength ? 'is-on' : undefined} key={level} aria-hidden="true" />
      ))}
      <small>{strengthLabel(props.text, props.strength)}</small>
    </span>
  )
}
