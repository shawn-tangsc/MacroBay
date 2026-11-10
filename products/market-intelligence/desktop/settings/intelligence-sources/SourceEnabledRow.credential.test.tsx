// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../shared/i18n/productText'
import { SourceEnabledRow } from './SourceRows'

/**
 * 需不需要 API Key，决定开关能不能动（用户 2026-11-11）：
 * - 免钥匙源：自由启停；
 * - 需钥匙源：Key 没配好之前 `aria-disabled`、点击不调写接口、状态不变；旁边一颗 ⓘ 说「先配置 API Key」。
 *   配置并验证通过后（`credentialMissing` 变 false）开关自动可用——这里用同一个组件的两次渲染证明。
 */
const t = productText['zh-CN'].settings.intelligenceSources
let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

const source = {
  sourceId: 'twelve-data-market', providerId: 'twelve-data', displayName: 'Twelve Data', agents: [], panels: ['dashboard'],
  visibility: 'visible', collection: 'adapter', kind: 'feed', capabilities: {}, readiness: 'live',
  enabled: false, healthState: 'off', healthMarker: 'none'
} as never

function labels() {
  return {
    badges: t.sourceBadges,
    jobRegistered: t.jobRegistered,
    jobNotRegistered: t.jobNotRegistered,
    toggleSource: t.toggleSource
  }
}

async function render(credentialMissing: boolean, enabled = false): Promise<{ host: HTMLElement; onToggle: ReturnType<typeof vi.fn> }> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const onToggle = vi.fn()
  await act(async () => {
    root!.render(createElement(ShellLanguageProvider, {
      language: 'zh-CN',
      children: createElement(SourceEnabledRow, {
        labels: labels(),
        name: 'Twelve Data',
        onToggle,
        proxyConfigured: true,
        resolveText: (key: string) => key === 'settings.intelligenceSources.credentialRequiredToEnable'
          ? t.credentialRequiredToEnable
          : key === 'settings.intelligenceSources.credentialRequiredToEnableAria'
            ? t.credentialRequiredToEnableAria
            : '',
        source: { ...(source as Record<string, unknown>), enabled } as never,
        tags: [],
        unavailable: false,
        ...(credentialMissing ? { credentialMissing: true } : {})
      })
    }))
  })
  return { host, onToggle }
}

describe('源行的启停开关按「需不需要 Key」分两种', () => {
  it('keeps the switch unusable and calls nothing while the key is missing', async () => {
    const { host, onToggle } = await render(true)
    const control = host.querySelector<HTMLElement>('[role="switch"]')
    expect(control?.getAttribute('aria-disabled')).toBe('true')
    expect(control?.getAttribute('aria-checked')).toBe('false')
    // 旁边那颗 ⓘ 说「先配置 API Key」（正文里不放整句）。
    expect(host.querySelector(`[aria-label="${t.credentialRequiredToEnableAria}"]`)).not.toBeNull()
    expect(host.querySelector('.source-provider-detail__row')?.textContent).not.toContain(t.credentialRequiredToEnable)
    await act(async () => { control?.click() })
    expect(onToggle).not.toHaveBeenCalled()
    expect(control?.getAttribute('aria-checked')).toBe('false')
  })

  it('becomes usable once the key is configured', async () => {
    const { host, onToggle } = await render(false)
    const control = host.querySelector<HTMLElement>('[role="switch"]')
    expect(control?.getAttribute('aria-disabled')).toBeNull()
    expect(host.querySelector(`[aria-label="${t.credentialRequiredToEnableAria}"]`)).toBeNull()
    await act(async () => { control?.click() })
    expect(onToggle).toHaveBeenCalledWith(true)
  })
})

describe('默认值只读投影，界面不自己造', () => {
  it('shows a no-key source as on when the projection says enabled', async () => {
    // 免钥匙源的「默认启用」由服务层 profile 缺省给；界面读到什么画什么。
    const { host, onToggle } = await render(false, true)
    const control = host.querySelector<HTMLElement>('[role="switch"]')
    expect(control?.getAttribute('aria-checked')).toBe('true')
    expect(control?.getAttribute('aria-disabled')).toBeNull()
    await act(async () => { control?.click() })
    expect(onToggle).toHaveBeenCalledWith(false)
  })

  it('keeps a key-required source off and unusable when the projection says disabled', async () => {
    const { host, onToggle } = await render(true, false)
    const control = host.querySelector<HTMLElement>('[role="switch"]')
    expect(control?.getAttribute('aria-checked')).toBe('false')
    expect(control?.getAttribute('aria-disabled')).toBe('true')
    await act(async () => { control?.click() })
    expect(onToggle).not.toHaveBeenCalled()
  })
})
