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
  // 解析器带键联合，四个 `labelKey` 因此被锁在闭集里：写错一处编译就红，不靠评审发现。
  const resolveText = (key: AgentTooltipKey): string => resolveAgentTooltipText(t, key)

  return (
    <div className="agent-message-navigation" aria-label={t.messages.anchorRailAria}>
      <Tooltip labelKey="messages.navigate-top" resolveText={resolveText}>
        <Button
          type="text"
          size="small"
          className="agent-message-navigation-button"
          icon={<ChevronsUp size={14} />}
          aria-label={t.messages.navigateTop}
          onClick={onTop}
        />
      </Tooltip>
      <Tooltip labelKey="messages.navigate-previous" resolveText={resolveText}>
        <Button
          type="text"
          size="small"
          className="agent-message-navigation-button"
          icon={<ArrowUp size={14} />}
          aria-label={t.messages.navigatePrevious}
          onClick={onPrevious}
        />
      </Tooltip>
      <Tooltip labelKey="messages.navigate-next" resolveText={resolveText}>
        <Button
          type="text"
          size="small"
          className="agent-message-navigation-button"
          icon={<ArrowDown size={14} />}
          aria-label={t.messages.navigateNext}
          onClick={onNext}
        />
      </Tooltip>
      <Tooltip labelKey="messages.navigate-bottom" resolveText={resolveText}>
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
