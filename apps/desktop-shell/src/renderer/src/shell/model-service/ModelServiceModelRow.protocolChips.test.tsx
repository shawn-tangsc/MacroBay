// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type { ModelChatProtocol, ModelDefinition } from '@platform/ai/providers/modelProviderTypes'
import type { ModelDetectionResult } from '@platform/ai/providers/modelDetection/types'
import { applyProtocolSets } from '@platform/ai/providers/modelProtocolSets'

import { platformText } from '../../i18n/platformText'

import { ModelServiceModelRow } from './ModelServiceModelRow'
import type { ModelDetectionModelStatus } from './useModelDetection'

/**
 * PLAT-82：模型行**协议 chip**（支持哪个就画哪个）。
 *
 * 反例必须钉住：只有 messages 端点的供应商不画 chat 标，纯 Gemini 供应商只有 google 标 ——
 * 协议集合来自 `supportedProtocols`（`deriveModelSupportedProtocols`），不在这里补全。
 */
const labels = platformText['en-US'].models

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

/** 走真实补齐口径（存储/同步链同一个函数），避免测试自己拼 `supportedProtocols`。 */
function syncedModel(
  providerDefaultProtocol: ModelChatProtocol,
  overrides: Partial<ModelDefinition> = {}
): ModelDefinition {
  return applyProtocolSets({
    id: 'model-1',
    name: 'Model 1',
    capabilities: { chat: true },
    chatProtocol: providerDefaultProtocol,
    ...overrides
  }, providerDefaultProtocol)
}

function explicitModel(supportedProtocols: ModelChatProtocol[], overrides: Partial<ModelDefinition> = {}): ModelDefinition {
  return {
    id: 'model-1',
    name: 'Model 1',
    capabilities: { chat: true },
    supportedProtocols,
    chatProtocol: 'chat-completions',
    ...overrides
  }
}

async function mountRow(
  model: ModelDefinition,
  detectionResult?: ModelDetectionResult,
  detectionStatus: ModelDetectionModelStatus = 'ok'
): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(ModelServiceModelRow, {
      labels,
      providerId: 'acme',
      model,
      detectionStatus: detectionResult === undefined ? undefined : detectionStatus,
      ...(detectionResult === undefined ? {} : { detectionResult }),
      isRemovingModel: false,
      onEditModel: () => undefined,
      onRemoveModel: async () => true
    }))
  })
  return container
}

async function chipProtocols(
  model: ModelDefinition,
  detectionResult?: ModelDetectionResult
): Promise<HTMLElement[]> {
  const container = await mountRow(model, detectionResult)
  return [...container.querySelectorAll<HTMLElement>('[data-model-protocol-chip]')]
}

/** 本次 run 的协议结论（只关心协议项时用）。 */
function probes(entries: Array<{ protocol: string; ok: boolean; reasonCode?: string; reused?: boolean }>): ModelDetectionResult {
  return {
    runId: 'run-1',
    modelId: 'model-1',
    status: entries.every((entry) => entry.ok) ? 'ok' : 'failed',
    protocols: entries as ModelDetectionResult['protocols']
  }
}

function titleOf(chip: HTMLElement | undefined): string | null {
  return chip?.getAttribute('title') ?? null
}

describe('PLAT-82 行内协议 chip', () => {
  it('renders all four supported protocols in the fixed order with brand icons', async () => {
    const chips = await chipProtocols(
      explicitModel(['chat-completions', 'responses', 'messages', 'gemini'])
    )

    expect(chips.map((chip) => chip.getAttribute('data-model-chip'))).toEqual([
      'chat-completions',
      'responses',
      'messages',
      'gemini'
    ])
    expect(chips.map((chip) => chip.querySelector('[data-protocol-brand]')?.getAttribute('data-protocol-brand')))
      .toEqual(['openai', 'openai', 'anthropic', 'google'])
    // responses 与 chat/completions 同属 OpenAI：只有 responses 带右下角小点。
    expect(chips[0]?.querySelectorAll('[data-protocol-brand] circle')).toHaveLength(0)
    expect(chips[1]?.querySelectorAll('[data-protocol-brand] circle')).toHaveLength(1)
    // 协议 chip 排在能力 chip 之前（同一行内不换行）。
    const container = await mountRow(explicitModel(['chat-completions']))
    const protocolGroup = container.querySelector('[data-model-protocol-chips]')
    const capabilityGroup = container.querySelector('[data-model-chips]')
    expect(protocolGroup).not.toBeNull()
    expect(protocolGroup?.compareDocumentPosition(capabilityGroup as Node) ?? 0)
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('never invents chat/completions for a messages-only provider', async () => {
    const chips = await chipProtocols(syncedModel('messages'))

    expect(chips.map((chip) => chip.getAttribute('data-model-chip'))).toEqual(['messages'])
    expect(chips[0]?.querySelector('[data-protocol-brand]')?.getAttribute('data-protocol-brand')).toBe('anthropic')
  })

  it('shows only the google icon for a gemini-only provider', async () => {
    const chips = await chipProtocols(syncedModel('gemini'))

    expect(chips.map((chip) => chip.getAttribute('data-model-chip'))).toEqual(['gemini'])
    expect(chips[0]?.querySelector('[data-protocol-brand]')?.getAttribute('data-protocol-brand')).toBe('google')
  })

  it('shows chat/completions and messages together for a provider with both endpoints', async () => {
    // siliconflow 这类：默认端点 chat/completions，厂商逐条声明 messages。
    const chips = await chipProtocols(syncedModel('chat-completions', { messagesSupport: 'yes' }))

    expect(chips.map((chip) => chip.getAttribute('data-model-chip'))).toEqual(['chat-completions', 'messages'])
  })

  it('keeps a declared protocol visible even when supportedProtocols lags behind it', async () => {
    // 两处口径必须一致：声明过的协议一定有 chip（否则它失败时无法变红）。
    const chips = await chipProtocols(explicitModel(['chat-completions'], { declaredProtocols: ['messages'] }))

    expect(chips.map((chip) => chip.getAttribute('data-model-chip'))).toEqual(['chat-completions', 'messages'])
    expect(chips[1]?.getAttribute('data-model-protocol-source')).toBe('declared')
  })

  it('distinguishes a provider declaration from a default-endpoint inference in the title', async () => {
    const chips = await chipProtocols(syncedModel('chat-completions', { messagesSupport: 'yes' }))

    expect(titleOf(chips[0])).toBe('OpenAI Chat · Inferred from the default endpoint')
    expect(titleOf(chips[1])).toBe('Anthropic Messages · Provider declared')
    expect(chips[1]?.getAttribute('data-model-protocol-source')).toBe('declared')
    expect(chips[0]?.getAttribute('data-model-protocol-source')).toBe('endpoint')
  })

  it('red-marks only the provider-declared protocol that failed this run', async () => {
    const model = syncedModel('chat-completions', { messagesSupport: 'yes' })
    const container = await mountRow(model, {
      runId: 'run-1',
      modelId: model.id,
      status: 'failed',
      reasonCode: 'endpoint_unsupported',
      protocols: [
        { protocol: 'chat-completions', ok: true },
        { protocol: 'messages', ok: false, reasonCode: 'endpoint_unsupported' }
      ],
      declaredProtocolFailures: ['messages']
    })

    const messages = container.querySelector('[data-model-protocol-chip="messages"]')
    const chat = container.querySelector('[data-model-protocol-chip="chat-completions"]')
    expect(messages?.getAttribute('data-model-protocol-failed-chip')).toBe('messages')
    expect(messages?.className).toContain('capability-protocol-failed')
    expect(titleOf(messages as HTMLElement)).toBe(labels.detectionProtocolFailedTitle('Anthropic Messages'))
    // 没声明过 messages 的 chat/completions 不受同一条失败结论影响。
    expect(chat?.getAttribute('data-model-protocol-failed-chip')).toBeNull()
    expect(chat?.className).not.toContain('capability-protocol-failed')
  })

  it('red-marks a protocol that failed this run even when it was never declared', async () => {
    // 反例（GLM-4.5 的实际形态）：messages 是"历史实测通过"来的 chip，本次被限流打回。
    // 如果它不标红，行内两个 chip 会和行尾「协议 1/2」互相矛盾。
    const model = syncedModel('messages')
    const container = await mountRow(model, {
      runId: 'run-1',
      modelId: model.id,
      status: 'failed',
      reasonCode: 'rate_limited',
      protocols: [{ protocol: 'messages', ok: false, reasonCode: 'rate_limited' }],
      declaredProtocolFailures: []
    })

    const messages = container.querySelector('[data-model-protocol-chip="messages"]')
    expect(messages?.className).toContain('capability-protocol-failed')
    expect(messages?.getAttribute('data-model-protocol-stale-chip')).toBe('messages')
    expect(titleOf(messages as HTMLElement)).toBe(
      labels.modelProtocolChipThisRunFailed('Anthropic Messages', labels.probeReasonRateLimit, labels.modelProtocolSourceEndpoint)
    )
    // 行级红色只认"厂商声明过 + 失败"，未声明的不染整行。
    expect(container.querySelector('[data-model-row]')?.getAttribute('data-model-protocol-failed')).toBeNull()
  })
})

describe('PLAT-82 行内协议摘要（不落库，刷新即消失）', () => {
  it('appends the protocol count and keeps the per-protocol detail in the title', async () => {
    const model = syncedModel('chat-completions', { messagesSupport: 'yes' })
    const container = await mountRow(model, {
      runId: 'run-1',
      modelId: model.id,
      status: 'ok',
      protocols: [
        { protocol: 'chat-completions', ok: true, reused: true },
        { protocol: 'messages', ok: true }
      ]
    })

    const status = container.querySelector('[data-model-detection-status]')
    expect(status?.textContent).toBe('OK · Protocols 2/2')
    expect(status?.getAttribute('data-model-protocol-summary')).toBe('2/2')
    expect(status?.getAttribute('title')).toContain('OpenAI Chat ✓（reused connectivity）')
  })

  it('shows the failing protocol in the inline title', async () => {
    const model = syncedModel('chat-completions', { messagesSupport: 'yes' })
    const container = await mountRow(model, {
      runId: 'run-1',
      modelId: model.id,
      status: 'ok',
      protocols: [
        { protocol: 'chat-completions', ok: true, reused: true },
        { protocol: 'messages', ok: false, reasonCode: 'endpoint_unsupported' }
      ],
      declaredProtocolFailures: ['messages']
    })

    const status = container.querySelector('[data-model-detection-status]')
    expect(status?.textContent).toBe('OK · Protocols 1/2')
    expect(status?.getAttribute('data-model-protocol-summary')).toBe('1/2')
    expect(status?.getAttribute('title')).toContain(`Anthropic Messages ✗ ${labels.probeReasonEndpointUnsupported}`)
  })

  it('keeps the plain status when this run did not check protocols', async () => {
    const model = syncedModel('chat-completions')
    const container = await mountRow(model, {
      runId: 'run-1',
      modelId: model.id,
      status: 'ok',
      connectivity: { status: 'ok' }
    })

    const status = container.querySelector('[data-model-detection-status]')
    expect(status?.textContent).toBe('OK')
    expect(status?.getAttribute('data-model-protocol-summary')).toBeNull()
    expect(status?.getAttribute('title')).toBe('OK')
  })
})

describe('归一后的免费标签', () => {
  it('shows the free text tag for a zero-price model (OpenRouter style)', async () => {
    const container = await mountRow(explicitModel(['chat-completions'], {
      pricing: { currency: 'USD', promptPerMillion: 0, completionPerMillion: 0 }
    }))
    expect(container.querySelector('[data-model-free-tag]')?.textContent).toBe(labels.modelFreeTag)
  })

  it('shows the free text tag for a manually marked paid model', async () => {
    const container = await mountRow(explicitModel(['chat-completions'], {
      freeOverride: true,
      pricing: { currency: 'USD', promptPerMillion: 8, completionPerMillion: 28 }
    }))
    expect(container.querySelector('[data-model-free-tag]')?.textContent).toBe(labels.modelFreeTag)
  })

  it('keeps the existing discount badge for a discounted paid model and no free tag', async () => {
    const container = await mountRow(explicitModel(['chat-completions'], {
      pricing: { currency: 'USD', promptPerMillion: 8, completionPerMillion: 28, hasDiscount: true }
    }))
    expect(container.querySelector('[data-model-discount]')?.textContent).toBe(labels.modelDiscountBadge)
    expect(container.querySelector('[data-model-free-tag]')).toBeNull()
  })

  it('shows no free tag for a plain paid model', async () => {
    const container = await mountRow(explicitModel(['chat-completions'], {
      pricing: { currency: 'USD', promptPerMillion: 8, completionPerMillion: 28 }
    }))
    expect(container.querySelector('[data-model-free-tag]')).toBeNull()
  })
})

describe('PLAT-82 实测通过的协议（落库证据）也要出现在行上', () => {
  it('draws a probed-only protocol with the detection source', async () => {
    // siliconflow 这类同主机双端点：记录里原本只有 chat/completions，实测 messages 通过后
    // 主进程把证据写回（supportedProtocols + probedProtocols），行上必须出现 Anthropic 标。
    const chips = await chipProtocols(explicitModel(['chat-completions', 'messages'], {
      probedProtocols: ['messages']
    }))

    expect(chips.map((chip) => chip.getAttribute('data-model-protocol-chip'))).toEqual([
      'chat-completions',
      'messages'
    ])
    // 只补缺：已经按默认端点推断过的 chat 不算"实测通过"。
    expect(chips[0]?.getAttribute('data-model-protocol-source')).toBe('endpoint')
    expect(chips[1]?.getAttribute('data-model-protocol-source')).toBe('probe')
    expect(titleOf(chips[1])).toBe('Anthropic Messages · Passed by detection')
  })

  it('never turns a failed probe into a chip or a red mark', async () => {
    const model = explicitModel(['chat-completions'])
    const chips = await chipProtocols(model, {
      runId: 'run-1',
      modelId: model.id,
      status: 'failed',
      reasonCode: 'endpoint_unsupported',
      protocols: [
        { protocol: 'chat-completions', ok: true },
        { protocol: 'messages', ok: false, reasonCode: 'endpoint_unsupported' }
      ]
    })

    // 本次 run 的失败结论不落库、也不加 chip（记录是事实源）。
    expect(chips.map((chip) => chip.getAttribute('data-model-protocol-chip'))).toEqual(['chat-completions'])
  })

  it('does not duplicate a protocol that is both declared and probed', async () => {
    const chips = await chipProtocols(explicitModel(['chat-completions', 'messages'], {
      declaredProtocols: ['messages'],
      probedProtocols: ['messages']
    }))

    expect(chips.filter((chip) => chip.getAttribute('data-model-protocol-chip') === 'messages')).toHaveLength(1)
    // 厂商声明优先展示，不被"实测通过"覆盖。
    expect(chips[1]?.getAttribute('data-model-protocol-source')).toBe('declared')
    expect(titleOf(chips[1])).toBe('Anthropic Messages · Provider declared')
  })

  it('shows nothing extra for a model without evidence', async () => {
    const chips = await chipProtocols(explicitModel(['chat-completions']))

    expect(chips.map((chip) => chip.getAttribute('data-model-protocol-chip'))).toEqual(['chat-completions'])
    expect(chips[0]?.getAttribute('data-model-protocol-source')).toBe('endpoint')
  })

  it('keeps a probed protocol visible even when supportedProtocols lags behind', async () => {
    // 同步可能把 supportedProtocols 覆盖回厂商口径；实测证据不能因此丢标。
    const chips = await chipProtocols(explicitModel(['chat-completions'], { probedProtocols: ['messages'] }))

    expect(chips.map((chip) => chip.getAttribute('data-model-protocol-chip'))).toEqual(['chat-completions', 'messages'])
    expect(chips[1]?.getAttribute('data-model-protocol-source')).toBe('probe')
  })
})
