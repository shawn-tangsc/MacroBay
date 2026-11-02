import { ArrowDown, ArrowUp, ChevronsDown, ChevronsUp } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'

import { useAgentText } from '../agentTextProvider'
import { resolveAgentTextKey, type AgentTooltipKey } from '../agentTooltipText'

type AgentMessageNavigationProps = {
  onTop: () => void
  onPrevious: () => void
  onNext: () => void
  onBottom: () => void
}

export default function AgentMessageNavigation({
  onTop,
  onPrevious,
  onNext,
  onBottom
}: AgentMessageNavigationProps): React.ReactElement {
  const t = useAgentText()
  // 四个键取自闭合联合 `AgentTooltipKey`：写错一处编译就红，不靠评审发现。
  const tooltipKeys = {
    top: 'messages.navigateTop',
    previous: 'messages.navigatePrevious',
    next: 'messages.navigateNext',
    bottom: 'messages.navigateBottom'
  } as const satisfies Record<string, AgentTooltipKey>
  const resolveText = (key: string): string => resolveAgentTextKey(t, key)

  return (
    <div className="agent-message-navigation" aria-label={t.messages.anchorRailAria}>
      <IconButton
        ariaLabelKey="messages.navigateTop"
        className="agent-message-navigation-button"
        icon={ChevronsUp}
        onSelect={onTop}
        resolveText={resolveText}
        size="md"
        tooltipKey={tooltipKeys.top}
      />
      <IconButton
        ariaLabelKey="messages.navigatePrevious"
        className="agent-message-navigation-button"
        icon={ArrowUp}
        onSelect={onPrevious}
        resolveText={resolveText}
        size="md"
        tooltipKey={tooltipKeys.previous}
      />
      <IconButton
        ariaLabelKey="messages.navigateNext"
        className="agent-message-navigation-button"
        icon={ArrowDown}
        onSelect={onNext}
        resolveText={resolveText}
        size="md"
        tooltipKey={tooltipKeys.next}
      />
      <IconButton
        ariaLabelKey="messages.navigateBottom"
        className="agent-message-navigation-button"
        icon={ChevronsDown}
        onSelect={onBottom}
        resolveText={resolveText}
        size="md"
        tooltipKey={tooltipKeys.bottom}
      />
    </div>
  )
}
