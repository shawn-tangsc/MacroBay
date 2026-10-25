import { GitCompareArrows, Minus, TrendingDown, TrendingUp } from 'lucide-react'

import type { NewsSentimentText } from './NewsSentimentCard'

export function sentimentIcon(polarity: string): React.ReactElement {
  if (polarity === 'bullish') return <TrendingUp aria-hidden="true" size={12} />
  if (polarity === 'bearish') return <TrendingDown aria-hidden="true" size={12} />
  if (polarity === 'mixed') return <GitCompareArrows aria-hidden="true" size={12} />
  return <Minus aria-hidden="true" size={12} />
}

export function labelText(text: NewsSentimentText, label: string): string {
  if (label === 'positive' || label === 'bullish') return text.labels.bullish
  if (label === 'negative' || label === 'bearish') return text.labels.bearish
  if (label === 'mixed') return text.labels.mixed
  return text.labels.neutral
}
