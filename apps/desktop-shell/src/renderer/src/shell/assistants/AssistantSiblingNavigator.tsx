import { ChevronLeft, ChevronRight } from 'lucide-react'

import type { AssistantMessageEntity } from '@platform/ai/assistant-platform/schemas/messageSchemas'
import type { PlatformText } from '../../i18n/platformText'
import { selectAssistantSiblingIndex } from './assistantMessageRendering'

type AssistantSiblingNavigatorProps = {
  labels: PlatformText['assistants']
  siblings: readonly AssistantMessageEntity[]
  activeSiblingId: string
  onSelect: (messageId: string) => void
}

export function AssistantSiblingNavigator({
  labels,
  siblings,
  activeSiblingId,
  onSelect
}: AssistantSiblingNavigatorProps): React.ReactElement | null {
  if (siblings.length <= 1) return null
  const index = selectAssistantSiblingIndex(siblings, activeSiblingId)
  const previous = siblings[index - 1]
  const next = siblings[index + 1]

  return (
    <div className="assistant-sibling-nav">
      <button
        type="button"
        className="assistant-sibling-nav-button"
        disabled={!previous}
        aria-label={labels.previousSibling}
        onClick={() => previous && onSelect(previous.id)}>
        <ChevronLeft size={14} />
      </button>
      <span>
        {labels.siblingIndex.replace('{current}', String(index + 1)).replace('{total}', String(siblings.length))}
      </span>
      <button
        type="button"
        className="assistant-sibling-nav-button"
        disabled={!next}
        aria-label={labels.nextSibling}
        onClick={() => next && onSelect(next.id)}>
        <ChevronRight size={14} />
      </button>
    </div>
  )
}
