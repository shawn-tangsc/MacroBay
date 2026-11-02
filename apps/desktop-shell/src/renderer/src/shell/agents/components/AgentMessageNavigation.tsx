import { Button } from 'antd'
import { ArrowDown, ArrowUp, ChevronsDown, ChevronsUp } from 'lucide-react'

import { Tooltip } from '@platform/ui/components/tooltip'

import { useAgentText } from '../agentTextProvider'
import { resolveAgentTooltipText, type AgentTooltipKey } from '../agentTooltipText'

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
  const resolveText = (key: string): string => resolveAgentTooltipText(t, key)

  return (
    <div className="agent-message-navigation" aria-label={t.messages.anchorRailAria}>
      <Tooltip labelKey={tooltipKeys.top} resolveText={resolveText}>
        <Button
          type="text"
          size="small"
          className="agent-message-navigation-button"
          icon={<ChevronsUp size={14} />}
          aria-label={t.messages.navigateTop}
          onClick={onTop}
        />
      </Tooltip>
      <Tooltip labelKey={tooltipKeys.previous} resolveText={resolveText}>
        <Button
          type="text"
          size="small"
          className="agent-message-navigation-button"
          icon={<ArrowUp size={14} />}
          aria-label={t.messages.navigatePrevious}
          onClick={onPrevious}
        />
      </Tooltip>
      <Tooltip labelKey={tooltipKeys.next} resolveText={resolveText}>
        <Button
          type="text"
          size="small"
          className="agent-message-navigation-button"
          icon={<ArrowDown size={14} />}
          aria-label={t.messages.navigateNext}
          onClick={onNext}
        />
      </Tooltip>
      <Tooltip labelKey={tooltipKeys.bottom} resolveText={resolveText}>
        <Button
          type="text"
          size="small"
          className="agent-message-navigation-button"
          icon={<ChevronsDown size={14} />}
          aria-label={t.messages.navigateBottom}
          onClick={onBottom}
        />
      </Tooltip>
    </div>
  )
}
