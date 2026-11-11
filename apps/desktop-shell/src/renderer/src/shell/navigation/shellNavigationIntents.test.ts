// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'

import { APP_NAVIGATE_EVENT } from '@platform/workspace/navigation/navigationRequest'
import { productMenuEntries, productSettingsEntries } from '@products/generated/shellRegistry'

import { mergeShellNavItems } from './mergeShellNavigation'
import { openConversation } from './openConversation'
import {
  findProductSettingsPanelByIntent,
  openProductSettingsPanel,
  openProductSettingsPanelByIntent,
  resolveSettingsPanelForIntent
} from './openProductSettingsPanel'
import { resolveAvailableSettingsPanelKey } from './settingsPanelKey'

/**
 * R87：壳层两个导航封装的契约测试。
 *
 * 这两条用例证的是**契约**（detail 形状 + 目的地真的存在），不是「点了有反应」——后者归
 * `navigationLanding.test.tsx`，那条会挂真 `AppShell` 走同一套监听。
 */

afterEach(() => {
  document.body.replaceChildren()
})

function recordDetails(): Array<Record<string, unknown>> {
  const details: Array<Record<string, unknown>> = []
  window.addEventListener(APP_NAVIGATE_EVENT, ((event: CustomEvent) => {
    details.push(event.detail as Record<string, unknown>)
  }) as EventListener)
  return details
}

describe('openConversation', () => {
  it('goes to the agent conversation by default — one event, no settings key', () => {
    const details = recordDetails()
    openConversation()

    expect(details).toEqual([{ navKey: 'agents' }])
  })

  it('can also land on the assistant page, with the topic when there is one', () => {
    const details = recordDetails()

    openConversation({ page: 'assistants' })
    openConversation({ page: 'assistants', assistant: { assistantId: 'assistant-1', topicId: 'topic-9' } })

    expect(details).toEqual([
      { navKey: 'assistants' },
      { navKey: 'assistants', assistant: { assistantId: 'assistant-1', topicId: 'topic-9' } }
    ])
  })

  it('only names pages this build actually renders', () => {
    // 目的地存在 = `activateNavKey` 有页可切；少一个就是「点了停在原地」。
    const navKeys = mergeShellNavItems('zh-CN', productMenuEntries).map((item) => item.key)

    expect(navKeys).toContain('agents')
    expect(navKeys).toContain('assistants')
  })
})

/** 生成物的空数组是 `readonly []`；显式元素类型，别让 `.id` 被收成 `never`。 */
const registeredEntries: readonly {
  id: string
  title: { 'zh-CN': string; 'en-US': string }
}[] = productSettingsEntries

describe('openProductSettingsPanel', () => {
  it('every registered product panel resolves to itself — no silent fallback to the default pane', () => {
    // `resolveAvailableSettingsPanelKey` 不认识就回落到 models：那才是「落到别的页」。
    // 直接遍历注册表，所以「这一版任务没有产品设置条目」也不会让这条变成假绿或假红。
    for (const entry of registeredEntries) {
      expect(resolveAvailableSettingsPanelKey(entry.id, registeredEntries)).toBe(entry.id)
    }
  })

  it('no page declares the intent ⇒ undefined, so the caller shows no entry at all', () => {
    // 这条守的是「找不到就不出这个入口」：注册表是空的、或者没有一页标这个意图时，
    // 解析结果必须是 `undefined`（调用方据此不出按钮），**不是**回落到默认面板。
    expect(resolveSettingsPanelForIntent('resource-sources', [])).toBeUndefined()
    expect(resolveSettingsPanelForIntent('resource-sources', [{ id: 'sample-product.a' }])).toBeUndefined()
    expect(
      resolveSettingsPanelForIntent('resource-sources', [
        { id: 'sample-product.a' },
        { id: 'sample-product.b', navIntent: 'resource-sources' }
      ])
    ).toBe('sample-product.b')
  })

  it('opens the destination when this build registers one, and safely reports "no target" when it does not', () => {
    // 注册表是数据：某次构建可能没有任何一页声明这个意图（产品撤了那条注册）。
    // 壳层不许假设「意图一定有目标」——有就真跳，没有就返回 false 且**一个事件都不发**。
    const details = recordDetails()
    const panelKey = findProductSettingsPanelByIntent('resource-sources')
    const opened = openProductSettingsPanelByIntent('resource-sources')

    if (panelKey === undefined) {
      expect(opened).toBe(false)
      expect(details).toEqual([])
      return
    }

    expect(registeredEntries.some((entry) => entry.id === panelKey)).toBe(true)
    expect(opened).toBe(true)
    expect(details).toEqual([{ navKey: 'settings', settingsPanelKey: panelKey }])
  })

  it('refuses a panel key this build does not register, instead of landing on the fallback', () => {
    // @ts-expect-error 未注册的面板 id 不是合法入参——这正是这条封装要挡的「编出来的按钮」。
    expect(() => openProductSettingsPanel('sample-product.removed-panel'))
      .toThrowError('unknown-product-settings-panel:sample-product.removed-panel')
  })
})
