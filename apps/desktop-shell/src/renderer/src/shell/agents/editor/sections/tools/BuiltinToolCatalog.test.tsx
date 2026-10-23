import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { Tool } from '@platform/ai/agent-platform/schemas/toolSchemas'

import { BuiltinToolCatalog } from './BuiltinToolCatalog'
import { agentTextZh } from '../../../agentTextZh'

const tools: Tool[] = [
  {
    id: 'Bash',
    name: 'Bash',
    description: 'Executes shell commands in your environment',
    origin: 'builtin',
    approval: 'prompt'
  },
  {
    id: 'Read',
    name: 'Read',
    description: 'Reads the contents of files',
    origin: 'builtin',
    approval: 'auto'
  }
]

describe('BuiltinToolCatalog', () => {
  it('renders localized approval meaning instead of raw prompt/auto enum values', () => {
    const markup = renderToStaticMarkup(
      <BuiltinToolCatalog
        text={agentTextZh}
        icon={<span />}
        items={tools}
        disabledToolIds={new Set(['Bash'])}
        onToggle={() => undefined}
      />
    )

    expect(markup).toContain('禁用时需要人工审批')
    expect(markup).toContain('模式自动添加')
    expect(markup).not.toContain('>prompt<')
    expect(markup).not.toContain('>auto<')
  })

  it('renders enablement switches instead of secondary add/remove buttons', () => {
    const markup = renderToStaticMarkup(
      <BuiltinToolCatalog
        text={agentTextZh}
        icon={<span />}
        items={tools}
        disabledToolIds={new Set(['Bash'])}
        onToggle={() => undefined}
      />
    )

    expect(markup).toContain('role="switch"')
    expect(markup).toContain('aria-checked="false"')
    expect(markup).toContain('aria-checked="true"')
    expect(markup).not.toContain('移除')
    expect(markup).not.toContain('添加</button>')
  })
})
