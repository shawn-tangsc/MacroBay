import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createDefaultAppSettings, normalizeAppSettings, normalizeUpdateSettings } from '../schema/appSettings'
import { createSettingsStore, updateAppSettings } from './settingsStore'
import { createJsonFileStorage } from '../../storage/jsonFileStorage'

const defaultNetwork = createDefaultAppSettings().network

describe('app settings', () => {
  it('starts with the platform defaults for language, theme, and accent color', () => {
    expect(createDefaultAppSettings()).toEqual({
      language: 'zh-CN',
      themeMode: 'dark',
      accentColor: 'lime',
      timeZone: 'system',
      network: {
        proxyMode: 'system',
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
      webSearch: createDefaultAppSettings().webSearch,
      updates: createDefaultAppSettings().updates
    })
  })

  it('follows the operating-system proxy on fresh installs, with an empty custom address', async () => {
    // 2026-11-02 用户决定：默认跟随系统代理（系统没配代理时 Chromium 的 system 模式等价于直连）。
    // 自定义地址留空：切到「自定义代理」时不该继承任何旧地址。
    const store = createSettingsStore()

    await expect(store.get()).resolves.toMatchObject({
      network: {
        proxyMode: 'system',
        proxyUrl: '',
        proxyBypassRules: 'localhost,127.0.0.1,::1'
      }
    })
  })

  it('migrates the legacy implicit proxy default to the platform default', () => {
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
      // 读取时归一化成 Chromium 语法（逗号分隔）：空白/分号都是历史写法。
      proxyBypassRules: 'localhost,127.0.0.1'
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
      webSearch: createDefaultAppSettings().webSearch,
      updates: createDefaultAppSettings().updates
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
    expect(writes).toEqual(['en-US:dark', 'en-US:light'])
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
      themeMode: 'dark',
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
      webSearch: createDefaultAppSettings().webSearch,
      updates: createDefaultAppSettings().updates
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
      webSearch: createDefaultAppSettings().webSearch,
      updates: createDefaultAppSettings().updates
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
        webSearch: createDefaultAppSettings().webSearch,
      updates: createDefaultAppSettings().updates
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

describe('settings committed registration', () => {
  it('names what actually changed, and only notifies once the commit is complete', async () => {
    const store = createSettingsStore()
    const calls: unknown[] = []
    store.onCommitted((change) => calls.push(change))

    await store.update({ timeZone: 'Asia/Tokyo' })
    // 提交了但副作用还没跑完：此时通知订阅方，它读到的是半路状态。
    expect(calls).toHaveLength(0)

    store.notifyCommitted()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      changedKeys: ['timeZone'],
      previous: { timeZone: 'system' },
      next: { timeZone: 'Asia/Tokyo' }
    })
  })

  it('stays silent for a save that changes nothing, so a no-op save never reschedules a task', async () => {
    const store = createSettingsStore()
    const calls: unknown[] = []
    store.onCommitted((change) => calls.push(change))

    await store.update({ timeZone: 'Asia/Tokyo' })
    store.notifyCommitted()
    await store.update({ timeZone: 'Asia/Tokyo' })
    store.notifyCommitted()

    expect(calls).toHaveLength(1)
  })

  it('notifies each commit once and never repeats the previous one', async () => {
    const store = createSettingsStore()
    const calls: unknown[] = []
    store.onCommitted((change) => calls.push(change))

    await store.update({ timeZone: 'Asia/Tokyo' })
    store.notifyCommitted()
    store.notifyCommitted()
    await store.update({ timeZone: 'UTC' })
    store.notifyCommitted()

    expect(calls).toHaveLength(2)
  })

  it('does not turn a subscriber failure into a failed save', async () => {
    const store = createSettingsStore()
    store.onCommitted(() => {
      throw new Error('subscriber bug')
    })

    await expect(store.update({ timeZone: 'UTC' })).resolves.toMatchObject({ timeZone: 'UTC' })
    expect(() => store.notifyCommitted()).not.toThrow()
  })

  it('stops notifying after unsubscribe, and notifying before any commit is a no-op', async () => {
    const store = createSettingsStore()
    const calls: unknown[] = []
    const unsubscribe = store.onCommitted((change) => calls.push(change))

    expect(() => store.notifyCommitted()).not.toThrow()
    unsubscribe()
    await store.update({ timeZone: 'UTC' })
    store.notifyCommitted()

    expect(calls).toEqual([])
  })
})

describe('the update check switch', () => {
  it('is on by default, so a fresh install checks without anyone opting in', () => {
    expect(createDefaultAppSettings().updates).toEqual({ checkEnabled: true })
  })

  it('fills in the group for a settings file saved before the group existed', async () => {
    // 旧 settings.json 里没有 updates 这一组。归一化必须补默认值——漏了它就是「存了读不回」，
    // 而界面上的表现只是「开关每次都被重置」，没人会把它当成缺陷报上来。
    const legacy = { ...createDefaultAppSettings() } as Record<string, unknown>
    delete legacy.updates

    expect(normalizeAppSettings(legacy).updates).toEqual({ checkEnabled: true })

    const store = createSettingsStore({ read: async () => legacy, write: async () => undefined })
    await expect(store.get()).resolves.toMatchObject({ updates: { checkEnabled: true } })
  })

  it('falls back to the default for anything that is not a boolean', () => {
    for (const broken of [{ checkEnabled: 'false' }, { checkEnabled: null }, { checkEnabled: 0 }, {}, true, 'on', 1]) {
      expect(normalizeUpdateSettings(broken)).toEqual({ checkEnabled: true })
    }
  })

  it('keeps an explicit off and reads it back after a reopen', async () => {
    let written: unknown = undefined
    const storage = {
      read: async () => written ?? {},
      write: async (value: unknown) => {
        written = value
      }
    }

    const store = createSettingsStore(storage as never)
    await expect(store.update({ updates: { checkEnabled: false } })).resolves.toMatchObject({
      updates: { checkEnabled: false }
    })

    // 新进程：从磁盘读回，而不是从内存——这才是「存了能读回」。
    const reopened = createSettingsStore(storage as never)
    await expect(reopened.get()).resolves.toMatchObject({ updates: { checkEnabled: false } })
    expect(written).toMatchObject({ updates: { checkEnabled: false } })
  })
})
