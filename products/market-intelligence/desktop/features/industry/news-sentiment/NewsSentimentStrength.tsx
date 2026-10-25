import type { NewsSentimentText } from './NewsSentimentCard'

export function strengthLabel(text: NewsSentimentText, strength: number): string {
  const levels = text.drawer.detail.strengthLevels
  if (strength <= 2) return levels?.weak ?? '弱'
  if (strength >= 4) return levels?.strong ?? '强'
  return levels?.medium ?? '中'
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
