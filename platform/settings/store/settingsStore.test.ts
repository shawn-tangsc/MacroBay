import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createDefaultAppSettings, normalizeAppSettings } from '../schema/appSettings'
import { createSettingsStore, updateAppSettings } from './settingsStore'
import { createJsonFileStorage } from '../../storage/jsonFileStorage'

const defaultNetwork = createDefaultAppSettings().network

describe('app settings', () => {
  it('starts with the platform defaults for language, theme, and accent color', () => {
    expect(createDefaultAppSettings()).toEqual({
      language: 'zh-CN',
      themeMode: 'system',
      accentColor: 'lime',
      timeZone: 'system',
      network: {
        proxyMode: 'none',
        proxyUrl: '',
        proxyBypassRules: 'localhost,127.0.0.1,::1'
      },
      agent: {
        sessionPanelPosition: 'left',
        sessionNamingEnabled: true,
        sessionNamingPrompt: '',
        sessionNamingModelId: '',
        taskAutomation: { policyPreset: 'balanced' }
      },
      assistant: {
        topicNamingEnabled: true,
        topicNamingPrompt: '',
        topicNamingModelId: ''
      },
      modelDefaults: {
        assistantModelId: '',
        agentModelId: '',
        fastModelId: '',
        translationModelId: '',
        imageModelId: ''
      },
      chat: {
        messageStyle: 'plain',
        fontSize: 14,
        sendShortcut: 'enter',
        confirmDeleteMessage: true,
        messageNavigation: 'none',
        narrowMode: false
      },
      notifications: createDefaultAppSettings().notifications,
      observability: createDefaultAppSettings().observability,
      webSearch: createDefaultAppSettings().webSearch
    })
  })

  it('keeps fresh installs on direct networking instead of an implicit local proxy', async () => {
    const store = createSettingsStore()

    await expect(store.get()).resolves.toMatchObject({
      network: {
        proxyMode: 'none',
        proxyUrl: '',
        proxyBypassRules: 'localhost,127.0.0.1,::1'
      }
    })
  })

  it('migrates the legacy implicit proxy default to direct networking', () => {
    expect(
      normalizeAppSettings({
        network: {
          proxyMode: 'system',
          proxyUrl: 'socks5://127.0.0.1:1080',
          proxyBypassRules: 'localhost,127.0.0.1,::1'
        }
      }).network
    ).toEqual(defaultNetwork)
  })

  it('preserves explicit custom proxy settings during normalization', () => {
    expect(
      normalizeAppSettings({
        network: {
          proxyMode: 'custom',
          proxyUrl: ' http://127.0.0.1:7888 ',
          proxyBypassRules: ' localhost 127.0.0.1 '
        }
      }).network
    ).toEqual({
      proxyMode: 'custom',
      proxyUrl: 'http://127.0.0.1:7888',
      proxyBypassRules: 'localhost 127.0.0.1'
    })
  })

  it('updates only supported settings values', () => {
    const updated = updateAppSettings(createDefaultAppSettings(), {
      language: 'en-US',
      themeMode: 'dark',
      accentColor: 'cyan',
      agent: {
        sessionPanelPosition: 'right',
        sessionNamingEnabled: false,
        sessionNamingPrompt: 'Name in {{language}}.',
        sessionNamingModelId: 'openai:gpt-4o-mini',
        taskAutomation: { policyPreset: 'conservative' }
      },
      chat: {
        messageStyle: 'bubble',
        fontSize: 16,
        sendShortcut: 'mod-enter',
        confirmDeleteMessage: false,
        messageNavigation: 'buttons',
        narrowMode: true
      }
    })

    expect(updated).toEqual({
      language: 'en-US',
      themeMode: 'dark',
      accentColor: 'cyan',
      timeZone: 'system',
      network: defaultNetwork,
      agent: {
        sessionPanelPosition: 'right',
        sessionNamingEnabled: false,
        sessionNamingPrompt: 'Name in {{language}}.',
        sessionNamingModelId: 'openai:gpt-4o-mini',
        taskAutomation: { policyPreset: 'conservative' }
      },
      assistant: createDefaultAppSettings().assistant,
      modelDefaults: createDefaultAppSettings().modelDefaults,
      chat: {
        messageStyle: 'bubble',
        fontSize: 16,
        sendShortcut: 'mod-enter',
        confirmDeleteMessage: false,
        messageNavigation: 'buttons',
        narrowMode: true
      },
      notifications: createDefaultAppSettings().notifications,
      observability: createDefaultAppSettings().observability,
      webSearch: createDefaultAppSettings().webSearch
    })

    expect(
      updateAppSettings(updated, {
        language: 'fr-FR',
        themeMode: 'night',
        accentColor: 'red',
        agent: {
          sessionPanelPosition: 'top'
        },
        chat: {
          messageStyle: 'card',
          fontSize: 99,
          sendShortcut: 'space',
          confirmDeleteMessage: 'no',
          messageNavigation: 'orbital',
          narrowMode: 'yes'
        }
      })
    ).toEqual(updated)
  })

  it('normalizes and persists network settings updates', async () => {
    const writes: unknown[] = []
    const store = createSettingsStore({
      read: async () => undefined,
      write: async (value) => {
        writes.push(value)
      }
    })

    await expect(
      store.update({
        network: {
          proxyMode: 'custom',
          proxyUrl: '  http://127.0.0.1:7888  ',
          proxyBypassRules: '  localhost,127.0.0.1,::1  '
        }
      })
    ).resolves.toEqual({
      ...createDefaultAppSettings(),
      network: {
        proxyMode: 'custom',
        proxyUrl: 'http://127.0.0.1:7888',
        proxyBypassRules: 'localhost,127.0.0.1,::1'
      }
    })

    expect(writes).toEqual([
      {
        ...createDefaultAppSettings(),
        network: {
          proxyMode: 'custom',
          proxyUrl: 'http://127.0.0.1:7888',
          proxyBypassRules: 'localhost,127.0.0.1,::1'
        }
      }
    ])
  })

  it('keeps memory unchanged after a failed write and serializes later updates', async () => {
    let failFirst = true
    const writes: string[] = []
    const store = createSettingsStore({
      read: async () => undefined,
      write: async (value) => {
        if (failFirst) {
          failFirst = false
          throw new Error('disk-full')
        }
        writes.push(`${value.language}:${value.themeMode}`)
      }
    })
    await expect(store.update({ agent: { taskAutomation: { policyPreset: 'conservative' } } })).rejects.toThrow('disk-full')
    await expect(store.get()).resolves.toMatchObject({ agent: { taskAutomation: { policyPreset: 'balanced' } } })
    await Promise.all([store.update({ language: 'en-US' }), store.update({ themeMode: 'light' })])
    await expect(store.get()).resolves.toMatchObject({ language: 'en-US', themeMode: 'light' })
    expect(writes).toEqual(['en-US:system', 'en-US:light'])
  })

  it('persists recovered local policy and concurrent agent patches across reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'settings-policy-'))
    try {
      const path = join(directory, 'settings.json')
      const storage = createJsonFileStorage(path, createDefaultAppSettings())
      let fail = true
      const store = createSettingsStore({ read: storage.read, write: async (value) => { if (fail) { fail = false; throw new Error('disk-full') }; await storage.write(value) } })
      await expect(store.update({ agent: { taskAutomation: { policyPreset: 'conservative' } } })).rejects.toThrow('disk-full')
      await expect(store.get()).resolves.toMatchObject({ agent: { taskAutomation: { policyPreset: 'balanced' } } })
      await Promise.all([store.update({ agent: { taskAutomation: { policyPreset: 'conservative' } } }), store.update({ agent: { sessionPanelPosition: 'right', sessionNamingEnabled: false } })])
      const reopened = createSettingsStore(storage)
      await expect(reopened.get()).resolves.toMatchObject({ agent: { taskAutomation: { policyPreset: 'conservative' }, sessionPanelPosition: 'right', sessionNamingEnabled: false } })
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('normalizes persisted settings and writes updates back to storage', async () => {
    const writes: unknown[] = []
    const store = createSettingsStore({
      read: async () => ({
        language: 'en-US',
        themeMode: 'invalid',
        accentColor: 'violet',
        agent: {
          sessionPanelPosition: 'right'
        },
        chat: {
          messageStyle: 'bubble',
          fontSize: 18,
          sendShortcut: 'mod-enter',
          confirmDeleteMessage: false,
          messageNavigation: 'anchor',
          narrowMode: true
        }
      }),
      write: async (value) => {
        writes.push(value)
      }
    })

    await expect(store.get()).resolves.toEqual({
      language: 'en-US',
      themeMode: 'system',
      accentColor: 'violet',
      timeZone: 'system',
      network: defaultNetwork,
      agent: {
        sessionPanelPosition: 'right',
        sessionNamingEnabled: true,
        sessionNamingPrompt: '',
        sessionNamingModelId: '',
        taskAutomation: { policyPreset: 'balanced' }
      },
      assistant: createDefaultAppSettings().assistant,
      modelDefaults: createDefaultAppSettings().modelDefaults,
      chat: {
        messageStyle: 'bubble',
        fontSize: 18,
        sendShortcut: 'mod-enter',
        confirmDeleteMessage: false,
        messageNavigation: 'anchor',
        narrowMode: true
      },
      notifications: createDefaultAppSettings().notifications,
      observability: createDefaultAppSettings().observability,
      webSearch: createDefaultAppSettings().webSearch
    })

    await expect(store.update({ themeMode: 'light' })).resolves.toEqual({
      language: 'en-US',
      themeMode: 'light',
      accentColor: 'violet',
      timeZone: 'system',
      network: defaultNetwork,
      agent: {
        sessionPanelPosition: 'right',
        sessionNamingEnabled: true,
        sessionNamingPrompt: '',
        sessionNamingModelId: '',
        taskAutomation: { policyPreset: 'balanced' }
      },
      assistant: createDefaultAppSettings().assistant,
      modelDefaults: createDefaultAppSettings().modelDefaults,
      chat: {
        messageStyle: 'bubble',
        fontSize: 18,
        sendShortcut: 'mod-enter',
        confirmDeleteMessage: false,
        messageNavigation: 'anchor',
        narrowMode: true
      },
      notifications: createDefaultAppSettings().notifications,
      observability: createDefaultAppSettings().observability,
      webSearch: createDefaultAppSettings().webSearch
    })
    expect(writes).toEqual([
      {
        language: 'en-US',
        themeMode: 'light',
        accentColor: 'violet',
        timeZone: 'system',
        network: defaultNetwork,
        agent: {
          sessionPanelPosition: 'right',
          sessionNamingEnabled: true,
          sessionNamingPrompt: '',
          sessionNamingModelId: '',
          taskAutomation: { policyPreset: 'balanced' }
        },
        assistant: createDefaultAppSettings().assistant,
      modelDefaults: createDefaultAppSettings().modelDefaults,
        chat: {
          messageStyle: 'bubble',
          fontSize: 18,
          sendShortcut: 'mod-enter',
          confirmDeleteMessage: false,
          messageNavigation: 'anchor',
          narrowMode: true
        },
        notifications: createDefaultAppSettings().notifications,
        observability: createDefaultAppSettings().observability,
        webSearch: createDefaultAppSettings().webSearch
      }
    ])
  })

  it('normalizes web search settings without persisting raw provider secrets', async () => {
    const writes: unknown[] = []
    const store = createSettingsStore({
      read: async () => undefined,
      write: async (value) => {
        writes.push(value)
      }
    })

    const updated = await store.update({
      webSearch: {
        defaultSearchProviderId: 'searxng',
        maxResults: 9,
        providerOverrides: {
          tavily: {
            enabled: true,
            apiKeys: ['raw-secret'],
            basicAuthPassword: 'raw-password'
          }
        }
      }
    })

    expect(updated.webSearch).toMatchObject({
      defaultSearchProviderId: 'searxng',
      maxResults: 9,
      providerOverrides: {
        tavily: {
          enabled: true
        }
      }
    })
    expect(JSON.stringify(updated)).not.toContain('raw-secret')
    expect(JSON.stringify(updated)).not.toContain('raw-password')
    expect(writes).toEqual([updated])
  })

  it('persists only a supported platform task automation policy preset', () => {
    const defaults = createDefaultAppSettings()

    expect(
      updateAppSettings(defaults, {
        agent: { taskAutomation: { policyPreset: 'conservative' } }
      }).agent.taskAutomation
    ).toEqual({ policyPreset: 'conservative' })
    expect(
      normalizeAppSettings({ agent: { taskAutomation: { policyPreset: 'unbounded' } } }).agent.taskAutomation
    ).toEqual({ policyPreset: 'balanced' })
  })
})
