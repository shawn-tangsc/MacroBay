import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createDefaultAppSettings, normalizeAppSettings, normalizeUpdateSettings } from '../schema/appSettings'
import type { NotificationRuntimeSettings } from '@platform/notifications/contracts/notificationContracts'
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
    // 落盘只写「这次真正改的顶层字段」：旧文件里没被点到的字段保持原文，连类型不认识的
    // 字段一起留着。读时归一（上面那些 `get()` 的期望）只发生在内存里。
    expect(writes).toHaveLength(1)
    const written = writes[0] as Record<string, unknown>
    expect(written.themeMode).toBe('light')
    // 旧文件里 `themeMode` 是非法值、`agent` 是半截对象：这次没点它们，原文原样写回。
    expect(written.agent).toEqual({ sessionPanelPosition: 'right' })
    expect(written.chat).toEqual({
      messageStyle: 'bubble',
      fontSize: 18,
      sendShortcut: 'mod-enter',
      confirmDeleteMessage: false,
      messageNavigation: 'anchor',
      narrowMode: true
    })
    // 归一后新增的顶层键必须补齐，否则下一次读又要走一遍默认值。
    expect(Object.keys(written).sort()).toEqual(Object.keys(createDefaultAppSettings()).sort())
    // 而且它绝不把归一后的「新形状」写回去掩盖旧值（旧主题值仍在内存里被解释成 dark）。
    expect(written.accentColor).toBe('violet')
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

describe('notification surface selection persists (2026-11-07)', () => {
  /**
   * 读者在「日历事件」那一排勾上「应用内提示」，重启后必须还在。
   *
   * 这个字段曾被 `normalizeNotificationSettings` 的**白名单静默丢掉**：写进去、读回来没有，
   * 页面把勾冲掉，表现是「这一格点了不能改」，而且不报错。所以验它必须**换一个 store 实例读**——
   * 在同一个 runtime 里读回来当然还在（内存在），那测的是内存不是落盘。
   */
  it('survives a fresh store reading the same file', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'settings-surface-'))
    try {
      const storage = createJsonFileStorage(join(directory, 'settings.json'), createDefaultAppSettings())
      const first = createSettingsStore({ read: storage.read, write: storage.write })
      await first.update({
        notifications: {
          ...createDefaultAppSettings().notifications,
          surfaceSelections: { 'calendar-events': { channel: true, toast: false } }
        }
      })

      const second = createSettingsStore({ read: storage.read, write: storage.write })
      const readBack = await second.get()
      expect(readBack.notifications.surfaceSelections).toEqual({ 'calendar-events': { channel: true, toast: false } })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('every notification setting survives a reload (2026-11-07)', () => {
  /**
   * 白名单是这套设置的问题源头：`normalizeNotificationSettings` 只留列出来的字段，
   * **每加一个字段都要人记得回来加一行，漏一次就静默丢数据**（`channelEvents` 丢了整整一版，
   * 用户报的「通知方式勾不动」也是同一个病）。
   *
   * 这里用 `Record<keyof NotificationRuntimeSettings, unknown>` 把字段清单交给编译器：
   * **以后新增一个字段而这里没跟上，tsc 直接红**，不必等人发现「怎么重启就没了」。
   */
  const EVERY_FIELD: Record<keyof NotificationRuntimeSettings, unknown> = {
    desktopEnabled: true,
    toastEnabled: true,
    popupEnabled: false,
    // 夹具里的产品名与事件 id 用中性 id：这里断言的是「字段存得住、读得回」，
    // 不依赖任何真实产品的存在——用真名会让平台侧看起来在认识某个产品。
    channelEvents: { 'sample-product.signal.triggered': false },
    surfaceSelections: { 'calendar-events': { channel: true, toast: false } },
    push: { channelId: 'channel-a' },
    retentionDays: 14,
    defaultSnoozeMinutes: 30,
    quietHours: { enabled: true, startLocalTime: '23:00', endLocalTime: '07:00' },
    minimumDisruptivePriority: 'high',
    productPermissions: { 'sample-product': { enabled: true, allowDesktop: false, allowToast: true, allowPopup: false } }
  }

  it('keeps every field the type declares, across a fresh store', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'settings-all-fields-'))
    try {
      const storage = createJsonFileStorage(join(directory, 'settings.json'), createDefaultAppSettings())
      const first = createSettingsStore({ read: storage.read, write: storage.write })
      await first.update({ notifications: { ...createDefaultAppSettings().notifications, ...EVERY_FIELD } })

      const second = createSettingsStore({ read: storage.read, write: storage.write })
      const readBack = (await second.get()).notifications
      for (const [key, value] of Object.entries(EVERY_FIELD)) {
        expect(readBack[key as keyof NotificationRuntimeSettings], key).toEqual(value)
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('unknown notification fields: kept, but reported once', () => {
  /**
   * 保留未知字段是为了不再「漏改一次就静默丢数据」；但**保留不等于默认它对**——
   * 拼错的键如果没人知道，就会永久潜伏。所以每个名字只报一次：
   * 报零次 = 静默丢信号，报每次 = 刷屏丢信噪，两种都会让人不看日志。
   */
  it('keeps a field the type does not know, and reports its name exactly once', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'settings-unknown-field-'))
    try {
      const storage = createJsonFileStorage(join(directory, 'settings.json'), createDefaultAppSettings())
      // 直接落一份带未知字段的文件：模拟新版本写过、或有人手改过。
      await storage.write({
        ...createDefaultAppSettings(),
        notifications: {
          ...createDefaultAppSettings().notifications,
          futureFlag: { enabled: true }
        } as never
      })

      const reported: string[] = []
      const store = createSettingsStore(
        { read: storage.read, write: storage.write },
        { onUnknownNotificationField: (field) => reported.push(field) }
      )
      const first = await store.get()
      expect((first.notifications as unknown as Record<string, unknown>).futureFlag).toEqual({ enabled: true })

      // 再写一次（归一化会再跑一遍）：字段还在，且**不再报第二遍**。
      await store.update({ notifications: { ...first.notifications, toastEnabled: true } })
      const after = await store.get()
      expect((after.notifications as unknown as Record<string, unknown>).futureFlag).toEqual({ enabled: true })
      expect(reported).toEqual(['futureFlag'])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('treats every field with a default as a known field (no unknown report)', async () => {
    // 登记表由类型强制（`satisfies Record<keyof NotificationSettings, true>`）。这条是它的运行期补角：
    // 「有默认值 = 一定被登记」——否则新加且带默认值的字段会被当成未知字段留一份副本、还报一次。
    const directory = mkdtempSync(join(tmpdir(), 'settings-defaults-known-'))
    try {
      const storage = createJsonFileStorage(join(directory, 'settings.json'), createDefaultAppSettings())
      const reported: string[] = []
      const store = createSettingsStore(
        { read: storage.read, write: storage.write },
        { onUnknownNotificationField: (field) => reported.push(field) }
      )
      await store.get()
      expect(reported).toEqual([])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('still rejects a known field of the wrong type instead of preserving it', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'settings-wrong-type-'))
    try {
      const storage = createJsonFileStorage(join(directory, 'settings.json'), createDefaultAppSettings())
      const store = createSettingsStore({ read: storage.read, write: storage.write })
      await store.update({
        notifications: {
          ...createDefaultAppSettings().notifications,
          // 类型错：不能被当成「未知字段」留下来，照旧回落默认。
          desktopEnabled: 'yes' as never
        }
      })
      const readBack = await store.get()
      expect(readBack.notifications.desktopEnabled).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('读时归一不落盘（2026-11-09 缺陷）', () => {
  it('keeps a legacy proxy block verbatim on disk when another key is saved', async () => {
    // 旧代理三联会被读时归一当成历史默认值（折成 `system` + 空地址）。读者只改了主题，
    // 磁盘上那条 `socks5://127.0.0.1:1080` 必须原样留着——否则他的代理设置在不知情时被改写。
    const legacyNetwork = { proxyMode: 'system', proxyUrl: 'socks5://127.0.0.1:1080', proxyBypassRules: 'localhost,127.0.0.1,::1' }
    const writes: unknown[] = []
    const store = createSettingsStore({
      read: async () => ({ language: 'zh-CN', themeMode: 'light', network: { ...legacyNetwork } }),
      write: async (value) => {
        writes.push(value)
      }
    })

    // 内存里是归一的（旧三联被解释成默认：system + 空地址）。
    await expect(store.get()).resolves.toMatchObject({ network: { proxyMode: 'system', proxyUrl: '' } })

    await store.update({ themeMode: 'dark' })

    expect(writes).toHaveLength(1)
    const written = writes[0] as Record<string, unknown>
    expect(written.themeMode).toBe('dark')
    expect(written.network).toEqual(legacyNetwork)
  })

  it('never writes while only reading', async () => {
    const writes: unknown[] = []
    const store = createSettingsStore({
      read: async () => ({ language: 'en-US' }),
      write: async (value) => {
        writes.push(value)
      }
    })
    await store.get()
    await store.get()
    expect(writes).toEqual([])
  })
})

describe('设置文件损坏时不许覆盖（2026-11-09 存储审计）', () => {
  it('rejects the save instead of writing defaults over an unreadable file', async () => {
    const writes: unknown[] = []
    const preserveCorruptCopy = vi.fn(async () => undefined)
    const store = createSettingsStore({
      read: async () => {
        throw new SyntaxError('Unexpected token } in JSON at position 42')
      },
      write: async (value) => {
        writes.push(value)
      },
      preserveCorruptCopy
    })

    // 读到坏文件 → 保存被拒绝，**不写默认值**。
    await expect(store.update({ themeMode: 'light' })).rejects.toThrow('settings-storage-unreadable')
    expect(writes).toEqual([])
    // 先留损坏副本（证据），再拒绝。
    expect(preserveCorruptCopy).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the corrupt copy cannot be preserved', async () => {
    const writes: unknown[] = []
    const store = createSettingsStore({
      read: async () => {
        throw new SyntaxError('bad json')
      },
      write: async (value) => {
        writes.push(value)
      },
      preserveCorruptCopy: async () => {
        throw new Error('disk full')
      }
    })

    // 留档失败 → 同样不写；错误照实抛给调用方（界面显示保存失败）。
    await expect(store.update({ themeMode: 'light' })).rejects.toThrow()
    expect(writes).toEqual([])
  })
})

describe('设置文件损坏：真实文件层（先留档、原文件不动）', () => {
  it('leaves the corrupt file byte-identical and writes a .corrupt-* copy', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'settings-corrupt-'))
    try {
      const file = join(dir, 'settings.json')
      const corrupt = '{"language":"zh-CN", "themeMode": '
      writeFileSync(file, corrupt, 'utf8')
      const storage = createJsonFileStorage(file, createDefaultAppSettings())
      const store = createSettingsStore(storage)

      await expect(store.update({ themeMode: 'light' })).rejects.toThrow('settings-storage-unreadable')

      // 原文件逐字节未变。
      expect(readFileSync(file, 'utf8')).toBe(corrupt)
      // 留了一份损坏副本，内容与原文件一致。
      const copies = readdirSync(dir).filter((name) => name.includes('.corrupt-'))
      expect(copies).toHaveLength(1)
      expect(readFileSync(join(dir, copies[0]!), 'utf8')).toBe(corrupt)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('启动期读不到设置：用默认值起来，不崩（2026-11-10）', () => {
  it('starts on defaults, keeps the copy path, and leaves get() throwing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'settings-startup-'))
    try {
      const file = join(dir, 'settings.json')
      const corrupt = '{"language":"zh-CN", "themeMode": '
      writeFileSync(file, corrupt, 'utf8')
      const store = createSettingsStore(createJsonFileStorage(file, createDefaultAppSettings()))

      // 应用能起来：拿到的是默认语言/主题，不是异常。
      const startup = await store.readStartup()
      expect(startup.language).toBe('zh-CN')
      expect(startup.themeMode).toBe('dark')

      // 状态要说清「读不到 + 副本在哪」，且副本真的在磁盘上、内容与原文件一致。
      const state = store.startupState()
      expect(state.unreadable).toBe(true)
      expect(state.copyPath).not.toBeNull()
      expect(readFileSync(state.copyPath!, 'utf8')).toBe(corrupt)

      // 契约没变：`get()` 仍然抛，保存路径继续 fail-closed。
      await expect(store.get()).rejects.toThrow('settings-storage-unreadable')
      await expect(store.update({ themeMode: 'light' })).rejects.toThrow('settings-storage-unreadable')

      // 重试仍然失败：状态还在、不抛。
      const retried = await store.retryStartupRead()
      expect(retried.unreadable).toBe(true)
      expect(retried.copyPath).toBe(state.copyPath)

      // 降级本身绝不写盘：原文件逐字节未变。
      expect(readFileSync(file, 'utf8')).toBe(corrupt)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rebuilds the file only when the reader explicitly resets', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'settings-reset-'))
    try {
      const file = join(dir, 'settings.json')
      writeFileSync(file, '{"language": ', 'utf8')
      const store = createSettingsStore(createJsonFileStorage(file, createDefaultAppSettings()))
      await store.readStartup()
      const copyPath = store.startupState().copyPath
      expect(copyPath).not.toBeNull()

      const rebuilt = await store.resetAfterUnreadable()
      expect(rebuilt).toEqual(createDefaultAppSettings())
      expect(store.startupState()).toEqual({ unreadable: false, copyPath: null })

      // 文件被重建为可读的默认值；坏文件副本仍在（读者唯一的证据）。
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { language?: string }
      expect(parsed.language).toBe('zh-CN')
      expect(readFileSync(copyPath!, 'utf8')).toBe('{"language": ')
      await expect(store.get()).resolves.toEqual(createDefaultAppSettings())
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports copyPath null when the corrupt copy could not be kept', async () => {
    const store = createSettingsStore({
      read: async () => {
        throw new SyntaxError('bad json')
      },
      write: async () => undefined,
      preserveCorruptCopy: async () => undefined
    })
    await store.readStartup()
    expect(store.startupState()).toEqual({ unreadable: true, copyPath: null })
  })
})
