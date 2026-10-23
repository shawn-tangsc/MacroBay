import { Button } from 'antd'
import { ExternalLink } from 'lucide-react'

import type { AssistantWebSearchSourcePart } from '@platform/ai/web-search/assistant/assistantWebSearchMessageParts'
import type { PlatformText } from '../../../i18n/platformText'

type MessageSourceCitationsProps = {
  labels: PlatformText['assistants']
  sources: AssistantWebSearchSourcePart[]
}

export function MessageSourceCitations({ labels, sources }: MessageSourceCitationsProps): React.ReactElement | null {
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
          <Button
            type="text"
            size="small"
            icon={<ExternalLink size={13} />}
            aria-label={labels.openSource}
            onClick={() => void window.platform.app.openExternal(source.url)}
          />
        </div>
      ))}
    </div>
  )
}
