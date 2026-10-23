import { describe, expect, it } from 'vitest'

import { buildMcpRuntimeCredentialActions } from './runtimeCredentialActions'

describe('buildMcpRuntimeCredentialActions', () => {
  it('returns no actions for healthy or inactive servers', () => {
    expect(buildMcpRuntimeCredentialActions({ status: 'connected' })).toEqual([])
    expect(buildMcpRuntimeCredentialActions({ status: 'connecting' })).toEqual([])
    expect(buildMcpRuntimeCredentialActions({ status: 'disabled', message: 'off' })).toEqual([])
  })

  it('surfaces auth actions with open URL, settings, copy hint, and restart', () => {
    expect(
      buildMcpRuntimeCredentialActions({
        status: 'error',
        errorKind: 'auth',
        message: 'Unauthorized. Visit https://example.com/oauth to continue.',
        providerUrl: 'https://provider.example/docs',
        baseUrl: 'https://mcp.example'
      })
    ).toEqual([
      {
        id: 'open-url',
        labelKey: 'editor.tools.mcpActionOpenUrl',
        url: 'https://provider.example/docs'
      },
      {
        id: 'open-settings',
        labelKey: 'editor.tools.mcpActionOpenSettings'
      },
      {
        id: 'copy-hint',
        labelKey: 'editor.tools.mcpActionCopyHint',
        hint: 'Unauthorized. Visit https://example.com/oauth to continue.'
      },
      {
        id: 'restart',
        labelKey: 'editor.tools.mcpActionRestart'
      }
    ])
  })

  it('prefers message URL when provider URL is missing for auth errors', () => {
    const actions = buildMcpRuntimeCredentialActions({
      status: 'error',
      errorKind: 'auth',
      message: 'Login required at https://auth.example/login.'
    })

    expect(actions.find((action) => action.id === 'open-url')).toMatchObject({
      id: 'open-url',
      url: 'https://auth.example/login'
    })
  })

  it('surfaces config/dependency settings and copy-hint actions', () => {
    expect(
      buildMcpRuntimeCredentialActions({
        status: 'error',
        errorKind: 'config',
        message: 'Missing a baseUrl.'
      })
    ).toEqual([
      {
        id: 'open-settings',
        labelKey: 'editor.tools.mcpActionOpenSettings'
      },
      {
        id: 'copy-hint',
        labelKey: 'editor.tools.mcpActionCopyHint',
        hint: 'Missing a baseUrl.'
      },
      {
        id: 'restart',
        labelKey: 'editor.tools.mcpActionRestart'
      }
    ])
  })

  it('surfaces retry for transient and abort errors', () => {
    expect(
      buildMcpRuntimeCredentialActions({
        status: 'error',
        errorKind: 'transient',
        retryable: true,
        message: 'Timed out'
      })
    ).toEqual([
      {
        id: 'copy-hint',
        labelKey: 'editor.tools.mcpActionCopyHint',
        hint: 'Timed out'
      },
      {
        id: 'retry',
        labelKey: 'editor.tools.mcpActionRetry'
      }
    ])
  })
})
