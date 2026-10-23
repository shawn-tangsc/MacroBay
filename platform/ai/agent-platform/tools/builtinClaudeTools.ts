import type { Tool } from '../schemas/toolSchemas'
import type { ClaudeToolDescriptor } from './toolRules'

type BuiltinToolSpec = {
  name: string
  summary: string
  approval: 'auto' | 'prompt'
}

/**
 * The Claude Code built-in tool surface. `approval` is the default decision
 * before an agent's permission mode or disabled-tool list is applied.
 */
const BUILTIN_TOOL_SPECS: readonly BuiltinToolSpec[] = [
  { name: 'Bash', summary: 'Executes shell commands in your environment', approval: 'prompt' },
  { name: 'Edit', summary: 'Makes targeted edits to specific files', approval: 'prompt' },
  { name: 'Glob', summary: 'Finds files based on pattern matching', approval: 'auto' },
  { name: 'Grep', summary: 'Searches for patterns in file contents', approval: 'auto' },
  { name: 'MultiEdit', summary: 'Performs multiple edits on a single file atomically', approval: 'prompt' },
  { name: 'NotebookEdit', summary: 'Modifies Jupyter notebook cells', approval: 'prompt' },
  { name: 'NotebookRead', summary: 'Reads and displays Jupyter notebook contents', approval: 'auto' },
  { name: 'Read', summary: 'Reads the contents of files', approval: 'auto' },
  { name: 'Task', summary: 'Runs a sub-agent to handle complex, multi-step tasks', approval: 'auto' },
  { name: 'TodoWrite', summary: 'Creates and manages structured task lists', approval: 'auto' },
  { name: 'WebFetch', summary: 'Fetches content from a specified URL', approval: 'prompt' },
  { name: 'WebSearch', summary: 'Performs web searches with domain filtering', approval: 'prompt' },
  { name: 'Write', summary: 'Creates or overwrites files', approval: 'prompt' }
]

export const claudeCodeBuiltinTools: Tool[] = BUILTIN_TOOL_SPECS.map(({ name, summary, approval }) => ({
  id: name,
  name,
  description: summary,
  origin: 'builtin',
  approval
}))

export function claudeCodeBuiltinToolDescriptors(): ClaudeToolDescriptor[] {
  return BUILTIN_TOOL_SPECS.map(({ name, summary }) => ({
    id: name,
    name,
    description: summary,
    origin: 'builtin'
  }))
}
