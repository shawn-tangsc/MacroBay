// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ProviderRuntimeCheckReport } from '@platform/ai/agent-platform/runtime/compatibility/providerRuntimeCheckTypes'

import { platformText } from '../i18n/platformText'

import {
  ProviderConnectionCheckDrawer,
  type ProviderConnectionCheckResult
} from './ProviderConnectionCheckDrawer'
import { connectionCheckDrawerLabels } from './providerConnectionCheckDrawerFixture'

const models = platformText['en-US'].models
const labels = connectionCheckDrawerLabels

const report: ProviderRuntimeCheckReport = {
  providerId: 'silicon',
  modelId: 'deepseek-ai/DeepSeek-V3.2',
  runtimeId: 'claude-code',
  ordinaryChat: { lane: 'ordinary-chat', status: 'timeout', summary: 'The operation timed out', failureCode: 'network_timeout' },
  direct: { lane: 'claude-code-direct', status: 'auth-failed', summary: 'Direct Claude Code authentication failed.', route: 'direct' },
  gateway: { lane: 'claude-code-gateway', status: 'gateway-required', summary: 'Gateway disabled.', route: 'gateway' },
  finalCompatibility: {
    providerId: 'silicon',
    modelId: 'deepseek-ai/DeepSeek-V3.2',
    runtimeId: 'claude-code',
    selectable: false,
    route: 'none',
    status: 'provider-disabled',
    summary: 'Provider is disabled.'
  },
  updatedAt: '2026-07-10T00:00:00.000Z',
  signature: 'sig'
}

const result: ProviderConnectionCheckResult = { ok: false, message: 'Provider is disabled.', report }

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function mount(props: {
  open?: boolean
  result?: ProviderConnectionCheckResult | null
  providerEnabled?: boolean
  onEnableProvider?: () => void
  onOpenProxySettings?: () => void
  onEnableModelGateway?: () => void
  onStart?: () => void
  environment?: { proxyMode: 'system' | 'custom' | 'none'; proxyUrl: string; targetHost: string }
} = {}): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(ProviderConnectionCheckDrawer, {
      open: props.open ?? true,
      models: [{ id: 'deepseek-ai/DeepSeek-V3.2', name: 'DeepSeek V3.2', capabilities: { chat: true, vision: false, embedding: false, tools: true } }],
      apiKeyOptions: [{ id: 'saved', label: 'sk-s**********7890' }],
      selectedModelId: 'deepseek-ai/DeepSeek-V3.2',
      selectedApiKeyOptionId: 'saved',
      isSubmitting: false,
      result: props.result === undefined ? result : props.result,
      labels,
      providerEnabled: props.providerEnabled ?? false,
      providerName: 'Silicon',
      hasApiKey: true,
      environment: props.environment ?? { proxyMode: 'none', proxyUrl: '', targetHost: 'aihubmix.com' },
      onEnableProvider: props.onEnableProvider ?? (() => undefined),
      onOpenProxySettings: props.onOpenProxySettings ?? (() => undefined),
      onEnableModelGateway: props.onEnableModelGateway ?? (() => undefined),
      onClose: () => undefined,
      onModelChange: () => undefined,
      onApiKeyOptionChange: () => undefined,
      onStart: props.onStart ?? (() => undefined)
    }))
  })
  return container
}

describe('PLAT-61 连接检查抽屉：诊断可用性', () => {
  it('shows the provider enable state first and offers an inline enable action', async () => {
    const onEnableProvider = vi.fn()
    await mount({ providerEnabled: false, onEnableProvider })

    const status = document.querySelector<HTMLElement>('[data-connection-check-provider-status]')
    expect(status?.textContent).toContain(models.connectionCheckProviderStatus)
    expect(status?.textContent).toContain(models.connectionCheckStatusDisabled)
    expect(status?.textContent).toContain('Silicon')
    expect(status?.getAttribute('data-provider-enabled')).toBe('false')

    const enable = document.querySelector<HTMLButtonElement>('[data-connection-check-enable]')
    expect(enable?.textContent).toContain(models.connectionCheckEnableProvider)
    await act(async () => enable?.click())
    expect(onEnableProvider).toHaveBeenCalledTimes(1)
  })


  it('shows a read-only environment block with proxy mode, target host and network diagnosis', async () => {
    const onOpenProxySettings = vi.fn()
    await mount({
      providerEnabled: true,
      onOpenProxySettings,
      environment: { proxyMode: 'custom', proxyUrl: 'http://user:super-secret@127.0.0.1:6153', targetHost: 'aihubmix.com' }
    })

    const env = document.querySelector<HTMLElement>('[data-connection-check-environment]')
    expect(env).not.toBeNull()
    expect(env?.textContent).toContain(models.connectionCheckEnvironment)
    expect(env?.querySelector('[data-env-proxy]')?.textContent).toContain(models.connectionCheckProxyCustom)
    expect(env?.querySelector('[data-env-proxy]')?.textContent).toContain('http://127.0.0.1:6153')
    // 账号密码绝不出现。
    expect(env?.textContent).not.toContain('super-secret')
    expect(env?.textContent).not.toContain('user:')
    expect(env?.querySelector('[data-env-host]')?.textContent).toContain('aihubmix.com')
    expect(env?.textContent).toContain(models.connectionCheckProxyNote)
    // 自定义代理 ⇒ 不给「去设置代理」按钮，但给「自定义代理仍失败」提示。
    expect(document.querySelector('[data-env-proxy-hint]')).toBeNull()
    expect(document.querySelector('[data-env-open-proxy]')).toBeNull()

    await act(async () => env?.querySelector<HTMLButtonElement>('[data-env-diagnosis]')?.click())
    expect(document.querySelector('[data-env-diagnosis-result]')?.textContent)
      .toContain(models.connectionCheckReasonTimeout)
  })

  it('explains a still-failing custom proxy with the target host', async () => {
    await mount({
      providerEnabled: true,
      environment: { proxyMode: 'custom', proxyUrl: 'http://127.0.0.1:7888', targetHost: 'aihubmix.com' }
    })

    const hint = document.querySelector<HTMLElement>('[data-env-custom-proxy-hint]')
    expect(hint?.textContent).toContain('aihubmix.com')
    expect(hint?.textContent).toBe(models.connectionCheckCustomProxyFailureHint('aihubmix.com'))
  })

  it('renders all three proxy modes', async () => {
    await mount({ providerEnabled: true, environment: { proxyMode: 'none', proxyUrl: '', targetHost: 'aihubmix.com' } })
    expect(document.querySelector('[data-env-proxy]')?.textContent).toContain(models.connectionCheckProxyDirect)

    await act(async () => root?.unmount())
    document.body.replaceChildren()
    await mount({ providerEnabled: true, environment: { proxyMode: 'system', proxyUrl: '', targetHost: 'aihubmix.com' } })
    expect(document.querySelector('[data-env-proxy]')?.textContent).toContain(models.connectionCheckProxySystem)
  })

  it('offers an actionable proxy hint on network failures when the mode is not custom', async () => {
    const onOpenProxySettings = vi.fn()
    await mount({
      providerEnabled: true,
      onOpenProxySettings,
      environment: { proxyMode: 'none', proxyUrl: '', targetHost: 'aihubmix.com' }
    })

    const hint = document.querySelector<HTMLElement>('[data-env-proxy-hint]')
    expect(hint?.textContent).toContain(models.connectionCheckProxyDirect)
    expect(hint?.textContent).toContain(models.connectionCheckOpenProxySettings)

    const action = hint?.querySelector<HTMLButtonElement>('[data-env-open-proxy]')
    await act(async () => action?.click())
    expect(onOpenProxySettings).toHaveBeenCalledTimes(1)
  })

  /**
   * PLAT-66：停用时主文案只有「先启用」这句，**不拼**上游 message、不给原始信息、不用 error 色。
   */
  it('keeps only the provider-disabled sentence when the provider is disabled', async () => {
    await mount({ providerEnabled: false })

    const ordinary = document.querySelector<HTMLElement>('[data-runtime-lane="ordinaryChat"]')
    expect(ordinary?.querySelector('[data-lane-reason]')?.textContent).toBe(models.connectionCheckReasonProviderDisabled)
    expect(ordinary?.querySelector('[data-lane-detail]')).toBeNull()
    expect(ordinary?.className).toContain('tone-warning')
  })

  it('keeps ordinary chat first and renders the Claude Code lanes with their own reasons', async () => {
    await mount({ providerEnabled: true })

    const lanes = [...document.querySelectorAll<HTMLElement>('[data-runtime-lane]')].map((lane) => lane.getAttribute('data-runtime-lane'))
    expect(lanes).toEqual(['ordinaryChat', 'direct', 'gateway', 'final'])
    expect(document.querySelector('[data-runtime-lane="direct"] [data-lane-hint]')?.textContent)
      .toBe(models.connectionCheckIrrelevantHint)
    // 直连失败时网关是真实阻塞项（不是可选项）。
    expect(document.querySelector('[data-runtime-lane="gateway"] [data-lane-reason]')?.textContent)
      .toBe(models.connectionCheckReasonGatewayDisabled)
    expect(document.querySelector('[data-runtime-lane="gateway"] [data-lane-hint]')?.textContent)
      .toBe(models.connectionCheckGatewayDisabledHint)
    expect(document.querySelector('[data-runtime-lane="ordinaryChat"] [data-lane-hint]')).toBeNull()
  })


  it('shows the upstream message after the classified reason for insufficient balance', async () => {
    const upstream = 'Your account balance is insufficient. Please recharge your account to continue using the API. (tid: 2026101814045281600525844444671)'
    const balanceReport: ProviderRuntimeCheckReport = {
      ...report,
      ordinaryChat: {
        lane: 'ordinary-chat',
        status: 'unknown',
        summary: `HTTP 402 · ${upstream}`,
        failureCode: 'account_balance_insufficient',
        upstreamMessage: upstream
      },
      finalCompatibility: {
        ...report.finalCompatibility,
        status: 'protocol-unsupported',
        summary: 'Authentication failed.'
      }
    }
    await mount({ providerEnabled: true, result: { ok: false, message: 'failed', report: balanceReport } })

    const ordinary = document.querySelector<HTMLElement>('[data-runtime-lane="ordinaryChat"]')
    const reason = ordinary?.querySelector('[data-lane-reason]')?.textContent ?? ''
    expect(reason).toContain(models.connectionCheckReasonAccountBalance)
    expect(reason).toContain('Your account balance is insufficient')
    expect(reason).not.toContain('Connection failed.')
    expect(ordinary?.querySelector('[data-lane-detail]')?.textContent).toContain('HTTP 402')
    expect(ordinary?.querySelector('[data-lane-detail]')?.textContent).toContain('tid: 2026101814045281600525844444671')
  })

  it('maps a disabled gateway to a clear status with an enable action', async () => {
    const onEnableModelGateway = vi.fn()
    await mount({ providerEnabled: true, onEnableModelGateway })

    const gateway = document.querySelector<HTMLElement>('[data-runtime-lane="gateway"]')
    expect(gateway?.querySelector('[data-lane-reason]')?.textContent).toBe(models.connectionCheckReasonGatewayDisabled)
    expect(gateway?.querySelector('[data-lane-reason]')?.textContent).not.toContain(models.connectionCheckReasonUnknown)
    expect(gateway?.querySelector('[data-lane-hint]')?.textContent).toBe(models.connectionCheckGatewayDisabledHint)

    const action = gateway?.querySelector<HTMLButtonElement>('[data-enable-model-gateway]')
    expect(action?.textContent?.trim()).toBe(models.connectionCheckEnableModelGateway)
    await act(async () => action?.click())
    expect(onEnableModelGateway).toHaveBeenCalledTimes(1)
  })

  it('shows the enabled state without the enable action once the provider is enabled', async () => {
    await mount({ providerEnabled: true })

    const status = document.querySelector<HTMLElement>('[data-connection-check-provider-status]')
    expect(status?.textContent).toContain(models.connectionCheckStatusEnabled)
    expect(document.querySelector('[data-connection-check-enable]')).toBeNull()
  })

  it('offers a retry action when the direct probe timed out', async () => {
    const onStart = vi.fn()
    const timeoutReport: ProviderRuntimeCheckReport = {
      ...report,
      ordinaryChat: { lane: 'ordinary-chat', status: 'ready', summary: 'Connection succeeded.' },
      direct: {
        lane: 'claude-code-direct',
        status: 'timeout',
        summary: 'Direct Claude Code runtime probe timed out.',
        route: 'direct'
      },
      gateway: { lane: 'claude-code-gateway', status: 'gateway-required', summary: 'Gateway disabled.', route: 'gateway' }
    }
    await mount({
      providerEnabled: true,
      onStart,
      result: { ok: false, message: 'timed out', report: timeoutReport }
    })

    const direct = document.querySelector<HTMLElement>('[data-runtime-lane="direct"]')
    expect(direct?.querySelector('[data-lane-reason]')?.textContent).toBe(models.connectionCheckProbeTimeout)
    const retry = direct?.querySelector<HTMLButtonElement>('[data-retry-runtime-check]')
    expect(retry?.textContent?.trim()).toBe(models.retry)
    await act(async () => retry?.click())
    expect(onStart).toHaveBeenCalledTimes(1)
  })
})
