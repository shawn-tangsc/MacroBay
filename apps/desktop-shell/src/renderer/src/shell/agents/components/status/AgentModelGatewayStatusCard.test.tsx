import { renderToStaticMarkup } from 'react-dom/server'

import { describe, expect, it, vi } from 'vitest'

import { AgentTextProvider } from '../../agentTextProvider'
import AgentModelGatewayStatusCard from './AgentModelGatewayStatusCard'

describe('AgentModelGatewayStatusCard', () => {
  it('renders one compact explanation with a single enable action', () => {
    const markup = renderToStaticMarkup(
      <AgentTextProvider language="zh-CN">
        <AgentModelGatewayStatusCard
          snapshot={null}
          modelLabel="TokenRhythm / deepseek-v4"
          onStart={vi.fn()}
          onStop={vi.fn()}
          onOpenModelService={vi.fn()}
        />
      </AgentTextProvider>
    )

    expect(markup).toContain('这个模型需要本地模型网关')
    expect(markup).toContain('当前模型：TokenRhythm / deepseek-v4')
    expect(markup).toContain('启用并启动网关')
    expect(markup).toContain('去模型服务检查直连')
    expect(markup).toContain('网关只在本机运行')
    expect(markup).toContain('未启用')
    expect(markup).not.toContain('Agent Model Gateway')
  })
})
