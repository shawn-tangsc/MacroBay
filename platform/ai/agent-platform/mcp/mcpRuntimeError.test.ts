import { describe, expect, it } from 'vitest'

import {
  classifyMcpRuntimeError,
  createMcpRuntimeConfigError,
  createMcpRuntimeDependencyError,
  isMcpRuntimeErrorRetryable
} from './mcpRuntimeError'

describe('mcp runtime error classification', () => {
  it('marks config errors as terminal and non-retryable', () => {
    const error = createMcpRuntimeConfigError('MCP stdio server "mcp-files" is missing a command.')

    expect(classifyMcpRuntimeError(error)).toEqual({
      kind: 'config',
      retryable: false,
      message: 'MCP stdio server "mcp-files" is missing a command.',
      code: 'MCP_RUNTIME_CONFIG'
    })
    expect(isMcpRuntimeErrorRetryable(error)).toBe(false)
  })

  it('marks dependency errors as terminal and non-retryable', () => {
    const error = createMcpRuntimeDependencyError('MCP SDK package is not installed in the desktop main process runtime.')

    expect(classifyMcpRuntimeError(error)).toEqual({
      kind: 'dependency',
      retryable: false,
      message: 'MCP SDK package is not installed in the desktop main process runtime.',
      code: 'MCP_RUNTIME_DEPENDENCY'
    })
    expect(isMcpRuntimeErrorRetryable(error)).toBe(false)
  })

  it('infers auth failures from status codes and treats them as terminal', () => {
    const error = Object.assign(new Error('Unauthorized'), {
      status: 401
    })

    expect(classifyMcpRuntimeError(error)).toEqual({
      kind: 'auth',
      retryable: false,
      message: 'Unauthorized',
      status: 401
    })
    expect(isMcpRuntimeErrorRetryable(error)).toBe(false)
  })

  it('infers auth failures from common error messages', () => {
    const error = new Error('403 Forbidden: invalid API key')

    expect(classifyMcpRuntimeError(error)).toEqual({
      kind: 'auth',
      retryable: false,
      message: '403 Forbidden: invalid API key'
    })
  })

  it('keeps transient runtime failures retryable', () => {
    const error = new Error('socket hang up')

    expect(classifyMcpRuntimeError(error)).toEqual({
      kind: 'transient',
      retryable: true,
      message: 'socket hang up'
    })
    expect(isMcpRuntimeErrorRetryable(error)).toBe(true)
  })

  it('keeps stale in-flight connect failures retryable', () => {
    const error = new Error('MCP server "mcp-files" changed while connecting.')

    expect(classifyMcpRuntimeError(error)).toEqual({
      kind: 'transient',
      retryable: true,
      message: 'MCP server "mcp-files" changed while connecting.'
    })
  })

  it('treats abort errors as non-retryable non-runtime failures', () => {
    const error = Object.assign(new Error('This operation was aborted'), {
      name: 'AbortError'
    })

    expect(classifyMcpRuntimeError(error)).toEqual({
      kind: 'abort',
      retryable: false,
      message: 'This operation was aborted'
    })
    expect(isMcpRuntimeErrorRetryable(error)).toBe(false)
  })
})
