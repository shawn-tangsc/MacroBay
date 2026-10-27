import { AlertCircle, Globe2 } from 'lucide-react'

import { LoadingSpinner } from '@platform/ui/components/loading'

import type { AssistantWebSearchMessagePart } from '@platform/ai/web-search/assistant/assistantWebSearchMessageParts'
import type { PlatformText } from '../../../i18n/platformText'
import { MessageSourceCitations } from './MessageSourceCitations'

type MessageWebSearchCardProps = {
  labels: PlatformText['assistants']
  part: AssistantWebSearchMessagePart
}

export function MessageWebSearchCard({ labels, part }: MessageWebSearchCardProps): React.ReactElement {
  const StatusIcon = part.status === 'error' ? AlertCircle : Globe2
  const title = part.toolName === 'web_fetch' ? labels.webFetchCardTitle : labels.webSearchCardTitle
  const statusLabel =
    part.status === 'running'
      ? labels.webSearchRunning
      : part.status === 'error'
        ? labels.webSearchFailed
        : `${part.sources.length} ${labels.webSearchSources}`

  return (
    <section className={`assistant-web-search-card ${part.status}`}>
      <header>
        {part.status === 'running' ? <LoadingSpinner size="sm" /> : <StatusIcon size={15} />}
        <strong>{title}</strong>
        <small>{statusLabel}</small>
      </header>
      {part.query ? <p>{part.query}</p> : null}
      {part.error ? <p>{part.error}</p> : null}
      <MessageSourceCitations labels={labels} sources={part.sources} />
    </section>
  )
}
