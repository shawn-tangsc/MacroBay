import { Button, Tooltip } from 'antd'
import { ArrowDown, ArrowUp, ChevronsDown, ChevronsUp } from 'lucide-react'

import { useAgentText } from '../agentTextProvider'

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

  return (
    <div className="agent-message-navigation" aria-label={t.messages.anchorRailAria}>
      <Tooltip title={t.messages.navigateTop} placement="left">
        <Button
          type="text"
          size="small"
          className="agent-message-navigation-button"
          icon={<ChevronsUp size={14} />}
          aria-label={t.messages.navigateTop}
          onClick={onTop}
        />
      </Tooltip>
      <Tooltip title={t.messages.navigatePrevious} placement="left">
        <Button
          type="text"
          size="small"
          className="agent-message-navigation-button"
          icon={<ArrowUp size={14} />}
          aria-label={t.messages.navigatePrevious}
          onClick={onPrevious}
        />
      </Tooltip>
      <Tooltip title={t.messages.navigateNext} placement="left">
        <Button
          type="text"
          size="small"
          className="agent-message-navigation-button"
          icon={<ArrowDown size={14} />}
          aria-label={t.messages.navigateNext}
          onClick={onNext}
        />
      </Tooltip>
      <Tooltip title={t.messages.navigateBottom} placement="left">
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
