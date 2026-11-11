// @vitest-environment happy-dom
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { createDefaultAppSettings } from '@platform/settings/schema/appSettings'

import { platformText } from '../../i18n/platformText'
import { AppShellSettingsLayout } from '../AppShellSettingsLayout'
import { groupShellSettingsPanels } from './mergeShellNavigation'
import { createBuiltInSettingsPanels } from './builtInNavEntries'

/**
 * 「这一页要连外网」的黄色 `VPN` 标签（读者 2026-11-12）。
 *
 * 两条判据分开守：**哪几页**带标签由注册表决定（数据层，穷尽断言），
 * **标签长在哪**由左导航决定（渲染层：紧跟在页名后面、页名本身不带它）。
 * 颜色与居中属样式，由 `styles.css` 的 `.settings-nav-tag` 承担，这里不断言像素。
 */
const PROXY_PAGES = ['models', 'web-search', 'channels'] as const
let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

describe('settings nav proxy tag', () => {
  it('declares exactly the three whole-page-outbound panels as needing a proxy', () => {
    const tagged = createBuiltInSettingsPanels('zh-CN')
      .filter((panel) => panel.requiresProxy === true)
      .map((panel) => panel.id)

    // 穷尽：新增一页默认不带标签；把某页标上会被这条看见，逼着改一次这个清单。
    expect([...tagged].sort()).toEqual([...PROXY_PAGES].sort())
  })

  it('carries the flag through the grouped navigation and drops it for product panels', () => {
    const groups = groupShellSettingsPanels('zh-CN', [])
    const flagged = groups
      .flatMap((group) => group.panels)
      .filter((panel) => panel.requiresProxy === true)
      .map((panel) => panel.key)

    expect([...flagged].sort()).toEqual([...PROXY_PAGES].sort())
  })

  it('renders the tag right after the page name, and only on those pages', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const t = platformText['zh-CN']

    await act(async () => {
      root!.render(createElement(AppShellSettingsLayout, {
        t,
        settings: createDefaultAppSettings(),
        settingsRecovery: { unreadable: false, copyPath: null },
        settingsReadRetrying: false,
        onRetrySettingsRead: () => undefined,
        onResetSettingsFile: async () => undefined,
        noticeText: null,
        resolveText: () => '',
        // 故意选一个不存在的面板：正文一个都不挂，只验左导航本身。
        settingsPanelKey: '__nav-only__',
        onSelectPanel: () => undefined,
        navGroups: groupShellSettingsPanels('zh-CN', []),
        productSettingsEntries: [],
        providersState: undefined as never,
        providers: [],
        onReloadProviders: () => undefined,
        onUpdateSettings: async () => undefined,
        onUpdateNetworkSettings: async () => undefined,
        onDraftSettingsChange: () => undefined,
        onRunProxySelfTest: async () => undefined,
        onManageAssistants: () => undefined,
        focusEntityId: null,
        appInfoName: 'MacroBay',
        proxySelfTest: { running: false, result: null },
        proxySelfTestView: null,
        modelService: null
      }))
    })

    const items = [...host.querySelectorAll<HTMLButtonElement>('.settings-nav-item')]
    const byLabel = (label: string): HTMLButtonElement => {
      const item = items.find((candidate) => candidate.textContent?.trim().startsWith(label))
      if (!item) throw new Error(`missing settings nav item: ${label}`)
      return item
    }

    const tags = host.querySelectorAll('.settings-nav-tag')
    expect(tags).toHaveLength(PROXY_PAGES.length)
    for (const tag of tags) expect(tag.textContent).toBe(t.settings.proxyRequiredTag)

    // 「频道」这一项：标签是页名 span 的下一个兄弟，不是排在整行末尾的浮标。
    const channels = byLabel(t.settings.channels)
    const labelSpan = channels.querySelector('span:not(.settings-nav-tag)')
    expect(labelSpan?.nextElementSibling?.classList.contains('settings-nav-tag')).toBe(true)
    expect(channels.textContent).toBe(`${t.settings.channels}${t.settings.proxyRequiredTag}`)

    // 本地页不加标签，标签才不会退化成装饰。
    expect(byLabel(t.settings.basicSettings).querySelector('.settings-nav-tag')).toBeNull()
    expect(byLabel(t.settings.notifications).querySelector('.settings-nav-tag')).toBeNull()
    expect(byLabel(t.about.title).querySelector('.settings-nav-tag')).toBeNull()
  })
})
