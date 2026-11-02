import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'
import { isUnconfiguredAgentModel } from '@platform/ai/agent-platform/runtime/effectiveAgentModel'

import { createDefaultAgentSession, setAgentModel } from './agentStateActions'
import { createSessionViaApi, setAgentModelViaApi } from './agentSessionDataApi'
import { getCreateSessionAgentId } from './agentSessionViewModel'

export type StartDefaultSessionInput = {
  state: AgentStoreState
  /** 当前智能体；空会话页与侧栏都用「当前智能体，否则第一个」这条规则。 */
  activeAgentId: string | null
  defaultAgentModelId?: string
  /** 默认会话名。句子归调用方（文案表），这里只接已经解析好的值。 */
  sessionName: string
  onStateChange: (updater: (state: AgentStoreState) => AgentStoreState) => void
}

/**
 * 建一条默认会话：取 agent id → 模型未配置时先补默认模型 → 建会话 → 失败回退到本地状态。
 *
 * 侧栏的「新建会话」和空会话页的「开始对话」是同一套流程，所以只有这一份实现：
 * 复制一份就是第二套，改默认名或失败回退时只会改到一处。
 *
 * 时序保持原样：`createSessionViaApi` 不 await，用户点完立刻回到界面，状态由 API 结果写回；
 * 失败时用本地状态兜底，读者不会卡在“点了没反应”。
 */
export function startDefaultSession({
  state,
  activeAgentId,
  defaultAgentModelId,
  sessionName,
  onStateChange
}: StartDefaultSessionInput): void {
  const agentId = getCreateSessionAgentId(activeAgentId)
  if (!agentId) return
  const agent = state.agents.find((item) => item.id === agentId)
  if (agent && defaultAgentModelId && isUnconfiguredAgentModel(agent.model)) {
    void setAgentModelViaApi(window.platform, agent.id, defaultAgentModelId).catch(() => {
      onStateChange((current) => setAgentModel(current, agent.id, defaultAgentModelId))
    })
  }

  void createSessionViaApi(window.platform, {
    agentId,
    name: sessionName,
    workspace: { type: 'system' }
  }).catch(() => {
    onStateChange((current) => createDefaultAgentSession(current, sessionName, agentId))
  })
}
