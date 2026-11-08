// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfigProvider } from 'antd'

import { platformText } from '../../../i18n/platformText'
import { TaskAutomationResourceJobsSection } from './TaskAutomationResourceJobsSection'

/**
 * 本构建里**没有任何一页**承担「资源来源」意图时的形状。
 *
 * 这时「装了产品但没启用」也拿不到可点的下一步：按契约不出入口，而不是造一个点了没反应的按钮
 * （壳会把不存在的面板静默落到默认页，读者以为点错了页）。所以这一支退成 `not-yet`、无动作。
 */
vi.mock('../../navigation/openProductSettingsPanel', () => ({
  findProductSettingsPanelByIntent: vi.fn(() => undefined),
  openProductSettingsPanelByIntent: vi.fn(() => false)
}))

const labels = platformText['zh-CN'].taskAutomation

describe('TaskAutomationResourceJobsSection without an intent page', () => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

  afterEach(() => {
    document.body.replaceChildren()
  })

  it('drops the enable action instead of pointing at a page this build does not have', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(ConfigProvider, { theme: { token: { motion: false } } },
        createElement(TaskAutomationResourceJobsSection, {
          labels,
          language: 'zh-CN',
          controller: {
            loading: false,
            error: false,
            errorReason: null,
            items: [],
            productNames: { 'market-intelligence': 'Market Intelligence' } as Record<string, string>,
            reload: vi.fn()
          }
        })))
    })

    expect(container.querySelector('[data-state="empty"]')).not.toBeNull()
    expect(container.querySelector('.state-view__action')).toBeNull()
    expect(container.textContent).toContain('还没有发生过')
  })
})
