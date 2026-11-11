// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'

import { APP_NAVIGATE_EVENT } from '@platform/workspace/navigation/navigationRequest'

/**
 * 这一版**没有任何一页**声明「资源来源」意图（产品把那条注册撤了）时的行为。
 *
 * 注册表是数据，壳层不许假设「意图一定有目标」：没有目标就返回 false 且**不发导航事件**，
 * 调用方据此不出入口。这里把生成注册表换成空表，所以这条与这一版装了哪个产品无关，
 * 也不会在产品撤注册之后变成「没人走过」的分支。
 */
vi.mock('@products/generated/shellRegistry', () => ({
  productMenuEntries: [],
  productSettingsEntries: [],
  // 本文件不读抽屉声明；保留完整导出的形状，免得模块以后新增消费者时这条 mock 先炸。
  productSettingsDrawers: []
}))

const { findProductSettingsPanelByIntent, openProductSettingsPanelByIntent } = await import('./openProductSettingsPanel')

afterEach(() => {
  document.body.replaceChildren()
})

describe('openProductSettingsPanelByIntent without a registered target', () => {
  it('reports unavailable and emits nothing, so the caller renders no entry', () => {
    const details: Array<Record<string, unknown>> = []
    const listener = ((event: CustomEvent) => {
      details.push(event.detail as Record<string, unknown>)
    }) as EventListener
    window.addEventListener(APP_NAVIGATE_EVENT, listener)

    expect(findProductSettingsPanelByIntent('resource-sources')).toBeUndefined()
    expect(openProductSettingsPanelByIntent('resource-sources')).toBe(false)
    // 一个事件都不发：发一个空 detail 的导航，就是「点了落到空白」。
    expect(details).toEqual([])

    window.removeEventListener(APP_NAVIGATE_EVENT, listener)
  })
})
