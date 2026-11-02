import { ExternalLink } from 'lucide-react'

import type { AssistantWebSearchSourcePart } from '@platform/ai/web-search/assistant/assistantWebSearchMessageParts'
import { IconButton } from '@platform/ui/components/icon-button'
import type { PlatformText } from '../../../i18n/platformText'
import { resolveAssistantsKey } from '../../../i18n/assistantsTextKey'

type MessageSourceCitationsProps = {
  labels: PlatformText['assistants']
  sources: AssistantWebSearchSourcePart[]
}

export function MessageSourceCitations({ labels, sources }: MessageSourceCitationsProps): React.ReactElement | null {
  const resolveAssistantText = (key: string): string => resolveAssistantsKey(labels, key)
  if (sources.length === 0) return null
  return (
    <div className="assistant-source-citations" aria-label={labels.webSearchSources}>
      {sources.map((source) => (
        <div key={`${source.id}:${source.url}`} className="assistant-source-row">
          <span className="assistant-source-index">{source.id}</span>
          <span className="assistant-source-copy">
            <strong>{source.title}</strong>
            <small>{source.url}</small>
            {source.snippet ? <span>{source.snippet}</span> : null}
          </span>
          <IconButton
            ariaLabelKey="assistants.openSource"
            icon={ExternalLink}
            onSelect={() => void window.platform.app.openExternal(source.url)}
            resolveText={resolveAssistantText}
            size="md"
          />
        </div>
      ))}
    </div>
  )
}
