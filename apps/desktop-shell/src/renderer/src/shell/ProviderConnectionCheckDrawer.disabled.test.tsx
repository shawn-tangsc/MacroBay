// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type { ProviderRuntimeCheckReport } from '@platform/ai/agent-platform/runtime/compatibility/providerRuntimeCheckTypes'

import { platformText } from '../i18n/platformText'

import {
  ProviderConnectionCheckDrawer,
  type ProviderConnectionCheckResult
} from './ProviderConnectionCheckDrawer'
import { connectionCheckDrawerLabels as labels } from './providerConnectionCheckDrawerFixture'

/**
 * PLAT-66：供应商**停用**时的连接检查抽屉。
 * 实测（七牛云）：停用状态仍发了一次请求，抽屉还把上游 `HTTP 502 · … has been retired`
 * 用「。：」拼在「供应商当前是停用状态」后面，句子错乱且信息矛盾。
 */
const models = platformText['en-US'].models

const retired = 'Model deepseek-v3 has been retired on 2026-10-09 and is no longer available.'

const report: ProviderRuntimeCheckReport = {
  providerId: 'qiniu',
  modelId: 'deepseek-v3',
  runtimeId: 'claude-code',
  ordinaryChat: {
    lane: 'ordinary-chat',
    status: 'unknown',
    summary: `HTTP 502 · upstream_error · ${retired}`,
    failureCode: 'http_5xx',
    upstreamMessage: retired
  },
  direct: {
    lane: 'claude-code-direct',
    status: 'unknown',
    summary: `HTTP 502 · upstream_error · ${retired}`,
    route: 'direct'
  },
  gateway: {
    lane: 'claude-code-gateway',
    status: 'unknown',
    summary: `HTTP 502 · upstream_error · ${retired}`,
    route: 'gateway'
  },
  finalCompatibility: {
    providerId: 'qiniu',
    modelId: 'deepseek-v3',
    runtimeId: 'claude-code',
    selectable: false,
    route: 'none',
    status: 'provider-disabled',
    summary: retired
  },
  updatedAt: '2026-10-19T00:00:00.000Z',
  signature: 'sig'
}

const result: ProviderConnectionCheckResult = { ok: false, message: retired, report }

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function mount(): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(ProviderConnectionCheckDrawer, {
      open: true,
      models: [{ id: 'deepseek-v3', name: 'DeepSeek V3', capabilities: { chat: true, vision: false, embedding: false, tools: true } }],
      apiKeyOptions: [{ id: 'saved', label: 'sk-q**********7890' }],
      selectedModelId: 'deepseek-v3',
      selectedApiKeyOptionId: 'saved',
      isSubmitting: false,
      result,
      labels,
      providerEnabled: false,
      providerName: '七牛云',
      hasApiKey: true,
      environment: { proxyMode: 'none', proxyUrl: '', targetHost: 'api.qnaigc.com' },
      onEnableProvider: () => undefined,
      onOpenProxySettings: () => undefined,
      onEnableModelGateway: () => undefined,
      onClose: () => undefined,
      onModelChange: () => undefined,
      onApiKeyOptionChange: () => undefined,
      onStart: () => undefined
    }))
  })
  return container
}

describe('PLAT-66 停用供应商的连接检查抽屉', () => {
  it('shows only the provider-disabled sentence and keeps the enable action', async () => {
    await mount()

    const reasons = [...document.querySelectorAll('[data-lane-reason]')].map((node) => node.textContent ?? '')
    expect(reasons).toHaveLength(4)
    for (const reason of reasons) expect(reason).toBe(models.connectionCheckReasonProviderDisabled)
    // 不再拼上游 message / 不再显示原始信息。
    expect(document.querySelector('[data-lane-detail]')).toBeNull()
    const rendered = document.querySelector('[data-testid="provider-runtime-check-report"]')?.textContent ?? ''
    expect(rendered).not.toContain('retired')
    expect(rendered).not.toContain('HTTP 5')
    // 停用不是 error 色；「启用」动作仍在抽屉顶部。
    expect(document.querySelector('[data-runtime-lane="ordinaryChat"]')?.className).toContain('tone-warning')
    expect(document.querySelector('[data-connection-check-enable]')).not.toBeNull()
  })
})
