import { describe, expect, it } from 'vitest'

import { claudeCodeBuiltinToolDescriptors } from './builtinClaudeTools'
import { buildMcpToolName, isMcpToolNameForServer } from './mcpToolName'
import { resolveSourceAccess } from './mcpSourcePolicy'
import {
  isToolDisabled,
  matchesToolRule,
  resolveToolApproval,
  resolveInvocationApproval,
  type ClaudeToolDescriptor
} from './toolRules'

describe('claude tool rules', () => {
  const descriptors = claudeCodeBuiltinToolDescriptors()
  const bash = descriptors.find((tool) => tool.id === 'Bash')!
  const read = descriptors.find((tool) => tool.id === 'Read')!
  const edit = descriptors.find((tool) => tool.id === 'Edit')!

  it('auto-approves default safe tools and prompts risky tools', () => {
    expect(resolveToolApproval(read, {}).approval).toBe('auto')
    expect(resolveToolApproval(bash, {}).approval).toBe('prompt')
  })

  it('acceptEdits auto-approves edit tools and simple bash file commands', () => {
    expect(resolveToolApproval(edit, { permissionMode: 'acceptEdits' }).approval).toBe('auto')
    expect(
      resolveInvocationApproval(bash, { permissionMode: 'acceptEdits' }, { toolName: 'Bash', input: { command: 'mkdir logs' } }).approval
    ).toBe('auto')
    expect(
      resolveInvocationApproval(bash, { permissionMode: 'acceptEdits' }, { toolName: 'Bash', input: { command: 'rm -rf logs' } }).approval
    ).toBe('prompt')
  })

  it('bypassPermissions auto-approves tools', () => {
    expect(resolveToolApproval(bash, { permissionMode: 'bypassPermissions' }).approval).toBe('auto')
  })

  it('matches disabled builtin and mcp rules', () => {
    const mcpTool: ClaudeToolDescriptor = {
      id: 'mcp__github__searchIssues',
      name: 'search_issues',
      origin: 'mcp',
      sourceName: 'github',
      sourceToolName: 'search_issues'
    }

    expect(matchesToolRule('builtin_Bash', bash)).toBe(true)
    expect(matchesToolRule('mcp__github__search_issues', mcpTool)).toBe(true)
    expect(matchesToolRule('mcp__github__*', mcpTool)).toBe(true)
    expect(isToolDisabled(mcpTool, { disabledTools: ['mcp__github__*'] })).toBe(true)
  })

  it('keeps source prompt approval stronger than bypass mode', () => {
    const mcpTool: ClaudeToolDescriptor = {
      id: 'mcp__browser__execute',
      name: 'execute',
      origin: 'mcp',
      sourceApproval: 'prompt'
    }

    expect(resolveToolApproval(mcpTool, { permissionMode: 'bypassPermissions' }).approval).toBe('prompt')
  })
})

describe('mcp tool naming and source policy', () => {
  it('builds stable function-call tool names and identifies long server names', () => {
    const toolId = buildMcpToolName('Very Long Server Name With Many Segments And Extra Characters', 'search issues')

    expect(toolId.length).toBeLessThanOrEqual(63)
    expect(toolId.startsWith('mcp__veryLongServerName')).toBe(true)
    expect(isMcpToolNameForServer('Very Long Server Name With Many Segments And Extra Characters', toolId)).toBe(true)
  })

  it('forces prompt for tools listed in disabledAutoApproveTools', () => {
    expect(
      resolveSourceAccess({ name: 'browser', disabledAutoApproveTools: ['execute'] }, { name: 'execute' })
    ).toEqual({
      enabled: true,
      approval: 'prompt'
    })
  })

  it('respects source disabled tools', () => {
    expect(resolveSourceAccess({ name: 'github', disabledTools: ['mcp__github__*'] }, { name: 'search' })).toEqual({
      enabled: false,
      approval: 'prompt'
    })
  })
})
