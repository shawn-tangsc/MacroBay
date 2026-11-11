// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../shared/i18n/productText'
import { SourceEnabledRow } from './SourceRows'

/**
 * 源行行尾是**文字状态**，不是开关（用户 2026-11-12：假控件比没有更坏）。
 *
 * 这一屏的启停唯一编辑入口是页头那颗组开关；行上只写「这个源开没开」，点不动的东西一个都不留。
 * 需钥匙源在 Key 没配好时仍用那颗 ⓘ 说「先配置 API Key」，配好并验证通过后提示自己消失。
 *
 * 旧判据「开关按需不需要 Key 分两种可用性」已随开关一起删除：锁在页头组开关上，
 * 由 `ProviderDetail.groupSwitch.test.tsx`（缺钥匙时组开关不可点、不写）接管。
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
    status: t.status
  }
}

async function render(credentialMissing: boolean, enabled = false): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(ShellLanguageProvider, {
      language: 'zh-CN',
      children: createElement(SourceEnabledRow, {
        labels: labels(),
        name: 'Twelve Data',
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
  return host
}

function stateText(host: HTMLElement): string {
  return host.querySelector('.source-provider-detail__row-state')?.textContent ?? ''
}

describe('源行只写状态，不画点不动的控件', () => {
  it('renders no switch and no toggle control; only the key hint stays interactive', async () => {
    const host = await render(true)
    expect(host.querySelector('[role="switch"]')).toBeNull()
    expect(host.querySelectorAll('select, input, [role="button"]')).toHaveLength(0)
    // 唯一可聚焦的不是启停控件，是那颗「先配置 API Key」的 ⓘ（说明入口，不是假开关）。
    const buttons = [...host.querySelectorAll('button')]
    expect(buttons).toHaveLength(1)
    expect(buttons[0]?.getAttribute('aria-label')).toBe(t.credentialRequiredToEnableAria)
    expect(stateText(host)).toBe(t.status.disabled)
  })

  it('reads the state straight from the projection, both ways', async () => {
    const off = await render(false)
    expect(stateText(off)).toBe(t.status.disabled)
    await act(async () => root?.unmount())
    document.body.replaceChildren()

    const on = await render(false, true)
    expect(stateText(on)).toBe(t.status.enabled)
  })

  it('keeps the key hint at ⓘ while the key is missing, and drops it once configured', async () => {
    const missing = await render(true)
    expect(missing.querySelector(`[aria-label="${t.credentialRequiredToEnableAria}"]`)).not.toBeNull()
    // 正文里不放整句说明（说明进 ⓘ）。
    expect(missing.querySelector('.source-provider-detail__row')?.textContent).not.toContain(t.credentialRequiredToEnable)
    await act(async () => root?.unmount())
    document.body.replaceChildren()

    const configured = await render(false)
    expect(configured.querySelector(`[aria-label="${t.credentialRequiredToEnableAria}"]`)).toBeNull()
  })
})