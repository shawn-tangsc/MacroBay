import type { AgentStoreState } from '../../../ai/agent-platform/store/agentStore'
import type { ReplaceAgentStateOptions } from '../agentStateCoordinator'

/**
 * 构造期晚绑定桥：`replaceAgentState` 依赖 `app.ts` 受保护区里的 `agentStateCoordinator`，
 * 而切片在 import 期就要构造，import 期没有调用方可以传参。
 *
 * `app.ts` 在 import 之后、任何构造之前调用 `bindReplaceAgentState`。**未绑定就调用必须抛具名错误**：
 * 构造期本不该调用它，静默 no-op 会让状态悄悄丢失。
 */
export type ReplaceAgentState = (state: AgentStoreState, options?: ReplaceAgentStateOptions) => Promise<AgentStoreState>

let implementation: ReplaceAgentState | null = null

export function bindReplaceAgentState(next: ReplaceAgentState): void {
  implementation = next
}

export function replaceAgentStateForConstruction(
  state: AgentStoreState,
  options?: ReplaceAgentStateOptions
): Promise<AgentStoreState> {
  if (implementation === null) throw new Error('replace-agent-state-before-bind')
  return implementation(state, options)
}

export function isReplaceAgentStateBound(): boolean {
  return implementation !== null
}
