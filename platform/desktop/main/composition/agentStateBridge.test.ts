import { describe, expect, it, vi } from 'vitest'

import {
  bindReplaceAgentState,
  isReplaceAgentStateBound,
  replaceAgentStateForConstruction
} from './agentStateBridge'

describe('agent state bridge', () => {
  it('throws a named error when called before binding', async () => {
    expect(isReplaceAgentStateBound()).toBe(false)
    // 同步抛：构造期调用不该走到这里，抛得越早越显眼。
    expect(() => replaceAgentStateForConstruction({ marker: 's' } as never)).toThrow(
      'replace-agent-state-before-bind'
    )
  })

  it('forwards to the bound implementation with the same arguments and result', async () => {
    const nextState = { marker: 'next' }
    const implementation = vi.fn(async () => nextState as never)
    bindReplaceAgentState(implementation)

    const options = { previousState: { marker: 'prev' } } as never
    await expect(replaceAgentStateForConstruction({ marker: 's' } as never, options)).resolves.toBe(nextState)
    expect(isReplaceAgentStateBound()).toBe(true)
    expect(implementation).toHaveBeenCalledWith({ marker: 's' }, options)
  })
})
