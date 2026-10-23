import { useMemo, useState } from 'react'
import { Input, Modal } from 'antd'
import { Bot, MessageSquareText, Search } from 'lucide-react'

import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'

import { buildAgentSearchResults, type AgentSearchResult } from '../agentSearchResults'
import { useAgentText } from '../agentTextProvider'

type AgentSearchModalProps = {
  open: boolean
  state: AgentStoreState
  onClose: () => void
  onSelectAgent: (agentId: string) => void
  onSelectSession: (sessionId: string) => void
}

export default function AgentSearchModal({
  open,
  state,
  onClose,
  onSelectAgent,
  onSelectSession
}: AgentSearchModalProps): React.ReactElement {
  const t = useAgentText()
  const [keyword, setKeyword] = useState('')
  const results = useMemo(
    () =>
      buildAgentSearchResults(state, keyword, {
        agentLabel: t.common.agent,
        unboundAgent: t.search.unboundAgent,
        noDescription: t.common.noDescription
      }),
    [keyword, state, t.common.agent, t.common.noDescription, t.search.unboundAgent]
  )

  return (
    <Modal
      open={open}
      title={t.search.title}
      footer={null}
      onCancel={onClose}
      width={680}
      className="agent-search-modal"
      destroyOnHidden>
      <div className="agent-search-panel">
        <Input
          autoFocus
          value={keyword}
          prefix={<Search size={15} />}
          placeholder={t.search.placeholder}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <div className="agent-search-results">
          {results.length === 0 ? (
            <div className="agent-search-empty">{t.search.empty}</div>
          ) : (
            results.map((result) => (
              <button key={getResultKey(result)} type="button" onClick={() => selectResult(result, onSelectAgent, onSelectSession)}>
                <span className="agent-search-result-icon">
                  {result.type === 'agent' ? <Bot size={15} /> : <MessageSquareText size={15} />}
                </span>
                <span>
                  <strong>{result.title}</strong>
                  <small>
                    <Bot size={12} />
                    {result.subtitle}
                  </small>
                  <em>{result.excerpt}</em>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </Modal>
  )
}

function getResultKey(result: AgentSearchResult): string {
  return result.type === 'agent' ? `agent:${result.agentId}` : `session:${result.sessionId}`
}

function selectResult(
  result: AgentSearchResult,
  onSelectAgent: (agentId: string) => void,
  onSelectSession: (sessionId: string) => void
): void {
  if (result.type === 'agent') onSelectAgent(result.agentId)
  else onSelectSession(result.sessionId)
}
