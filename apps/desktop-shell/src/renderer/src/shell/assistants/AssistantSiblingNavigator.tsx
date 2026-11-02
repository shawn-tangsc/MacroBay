import { ChevronLeft, ChevronRight } from 'lucide-react'

import type { AssistantMessageEntity } from '@platform/ai/assistant-platform/schemas/messageSchemas'
import { IconButton } from '@platform/ui/components/icon-button'
import type { PlatformText } from '../../i18n/platformText'
import { selectAssistantSiblingIndex } from './assistantMessageRendering'

/** 两个翻页箭头的读屏名：句子来自 `labels`，键只回答「哪一边」。 */
const PREVIOUS_SIBLING_KEY = 'assistants.sibling.previous'
const NEXT_SIBLING_KEY = 'assistants.sibling.next'

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
      <IconButton
        ariaLabelKey={PREVIOUS_SIBLING_KEY}
        icon={ChevronLeft}
        size="sm"
        disabled={!previous}
        onSelect={() => previous && onSelect(previous.id)}
        resolveText={(key) => (key === PREVIOUS_SIBLING_KEY ? labels.previousSibling : labels.nextSibling)}
      />
      <span>
        {labels.siblingIndex.replace('{current}', String(index + 1)).replace('{total}', String(siblings.length))}
      </span>
      <IconButton
        ariaLabelKey={NEXT_SIBLING_KEY}
        icon={ChevronRight}
        size="sm"
        disabled={!next}
        onSelect={() => next && onSelect(next.id)}
        resolveText={(key) => (key === NEXT_SIBLING_KEY ? labels.nextSibling : labels.previousSibling)}
      />
    </div>
  )
}
