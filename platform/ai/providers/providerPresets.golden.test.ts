import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { ModelChatProtocol, ProviderChatEndpoint } from './modelProviderTypes'
import { resolveProviderChatBase, resolveProviderPrimaryBase } from './providerChatEndpoints'
import { createSystemProviderPresets } from './providerPresets'

/**
 * PLAT-72：预设的行为护栏（golden snapshot）。
 *
 * 快照 `__fixtures__/providerPresets.golden.json` 是**端点收敛前**落下的全量输出
 * （`protocols` / `protocol` / `baseUrl` / `anthropicBaseUrl` / `extraEndpoints` + 模型清单），
 * 自那以后**没有重新生成**。现在预设只声明 `endpoints`，因此这里做两件事：
 *
 *  1. 除端点字段外的所有字段必须与快照逐字段一致（预设名字、模型清单、默认模型、链接…）；
 *  2. 新 `endpoints` 求出的每个协议 base 必须与**旧实现**（快照里的
 *     `protocols` + `anthropicBaseUrl` + `extraEndpoints` + `baseUrl`）算出的完全一致，
 *     且主地址仍等于旧 `baseUrl` —— 那一次收敛没有改变任何出站地址。
 */
const GOLDEN_PATH = resolve(process.cwd(), 'platform/ai/providers/__fixtures__/providerPresets.golden.json')

type GoldenPreset = {
  id: string
  name: string
  protocols: string[]
  protocol: string
  enabled: boolean
  baseUrl: string
  anthropicBaseUrl?: string
  extraEndpoints?: Record<string, string>
  apiKey: string
  isSystem: boolean
  websites?: Record<string, string | undefined>
  models: Array<{
    id: string
    name: string
    group?: string
    provider?: string
    presetModel?: boolean
    chatProtocol?: string
    capabilities: { chat: boolean; capabilitiesEdited?: boolean }
  }>
  defaultChatModelId?: string
}

const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as GoldenPreset[]

/** 快照里已被 `endpoints` 取代的字段。 */
const CONVERGED_KEYS = new Set([
  'protocols', 'protocol', 'protocolOverrides', 'anthropicBaseUrl', 'extraEndpoints'
])

/** 与持久化同口径的 canonical 形态：`JSON.stringify` 丢掉 undefined 字段。 */
function canon(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value))
}

function currentPresets(): Array<Record<string, unknown>> {
  return canon(createSystemProviderPresets()) as Array<Record<string, unknown>>
}

/**
 * 快照之后**有意**新增的字段：`websites.apiKey`（「获取密钥」入口）。
 *
 * 快照冻结的是端点与**已有**链接：快照里已经有 `apiKey` 的家（我们自己的邀请链接）
 * 仍然逐字比较，谁也不许改；快照里没有的家允许"只增不改"地补上 key 页。
 * 新增的 key 页自身由 `providerKeyLinks.test.ts` 守卫（http(s) + 非官网首页 + 每家都有）。
 */
const GOLDEN_PROVIDERS_WITH_API_KEY = new Set(
  golden.filter((preset) => preset.websites?.apiKey !== undefined).map((preset) => preset.id)
)

/** 去掉端点字段 + 模型级 `chatProtocol`（模型协议由下面的用例单独钉住）。 */
function legacyProjection(providers: readonly Record<string, unknown>[]): Array<Record<string, unknown>> {
  return providers.map((provider) => {
    const projected = Object.fromEntries(
      Object.entries(provider).filter(([key]) => !CONVERGED_KEYS.has(key) && key !== 'endpoints' && key !== 'imageEndpoints')
    )
    // 主地址现在由端点清单派生，尾斜杠作为端点归一的一部分被去掉（其余逐字不变）。
    if (typeof projected.baseUrl === 'string') projected.baseUrl = normalize(projected.baseUrl)
    if (Array.isArray(projected.models)) {
      projected.models = (projected.models as Array<Record<string, unknown>>).map((model) =>
        // `chatProtocol` 与协议集合都是端点收敛后新增的派生字段，快照里没有。
        Object.fromEntries(Object.entries(model).filter(([key]) =>
          key !== 'chatProtocol' && key !== 'supportedProtocols' && key !== 'declaredProtocols')))
    }
    // 新增的 `websites.apiKey` 从两侧一起摘掉（不动原对象：golden 是模块级共享数据）。
    const websites = provider.websites
    if (websites && !GOLDEN_PROVIDERS_WITH_API_KEY.has(String(provider.id))) {
      projected.websites = Object.fromEntries(
        Object.entries(websites as Record<string, unknown>).filter(([key]) => key !== 'apiKey')
      )
    }
    return projected
  })
}

function normalize(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '')
}

/** 旧实现的协议映射（快照里的 `protocols` 是供应商协议名）。 */
const PROVIDER_TO_CHAT: Record<string, ModelChatProtocol> = {
  openai: 'chat-completions',
  'openai-compatible': 'chat-completions',
  ollama: 'chat-completions',
  'new-api': 'chat-completions',
  gateway: 'chat-completions',
  'azure-openai': 'chat-completions',
  'openai-response': 'responses',
  anthropic: 'messages',
  gemini: 'gemini'
}

/** 旧实现：某协议在该供应商上能用的 base（不可用 ⇒ 空串）。 */
function legacyEndpointBase(preset: GoldenPreset, protocol: ModelChatProtocol): string {
  const declared = new Set(preset.protocols.map((entry) => PROVIDER_TO_CHAT[entry]).filter(Boolean))
  if (!declared.has(protocol)) return ''
  if (protocol === 'chat-completions') return normalize(preset.baseUrl)
  if (protocol === 'responses') return normalize(preset.extraEndpoints?.responses)
  if (protocol === 'gemini') return normalize(preset.extraEndpoints?.gemini)
  // messages：extraEndpoints.anthropic 优先，历史字段 anthropicBaseUrl 兜底。
  return normalize(preset.extraEndpoints?.anthropic) || normalize(preset.anthropicBaseUrl)
}

/** 端点收敛之后**有意**改过的端点（快照保持冻结，另有理由的改动在这里显式登记）。 */
const INTENTIONAL_ENDPOINT_CHANGES: ReadonlyArray<{ id: string; protocol: ModelChatProtocol; reason: string }> = [
  {
    id: 'mimo',
    protocol: 'responses',
    reason: '2026-10-21 带 Key 实测 `/v1/responses` 对 mimo-v2.6-flash / -pro 返回 200，此前未声明。'
  },
  {
    id: 'burncloud',
    protocol: 'gemini',
    reason: '2026-10-21 带 Key 实测 gemini-2.5-flash 走 /v1beta/...:generateContent 返回 200，与它列表里 30 条 supported_endpoint_types 含 gemini 一致。'
  },
  {
    id: 'aihubmix',
    protocol: 'responses',
    reason: '2026-10-21 实测 /v1/responses 走到计费校验（403 余额不足），且模型列表 14 条声明 responses。'
  },
  {
    id: 'aihubmix',
    protocol: 'gemini',
    reason: '2026-10-21 实测 /gemini/v1beta/models/{id}:generateContent 存在（需 x-goog-api-key），模型列表 11 条声明 gemini_api。'
  },
  {
    id: 'longcat',
    protocol: 'responses',
    reason: '2026-10-21 带 Key 实测 /openai/v1/responses 对 LongCat-2.0 返回 200，此前未声明。'
  },
  {
    id: 'stepfun',
    protocol: 'responses',
    reason: '2026-10-21 带 Key 实测 /v1/responses 对 step-3.7-flash 返回 200，且列表逐模型声明 responses。'
  },
  {
    id: 'baichuan',
    protocol: 'responses',
    reason: '2026-10-21 带 Key 实测 /v1/responses 对 Baichuan4-Air 返回 200（真生成），此前未声明。'
  },
  {
    id: 'minimax-global',
    protocol: 'responses',
    reason: '2026-10-21 带 Key 实测 /v1/responses 返回 402（路由存在，对照 404 page not found），此前未声明。'
  },
  {
    id: 'minimax',
    protocol: 'responses',
    reason: '2026-10-21 带 Key 实测 /v1/responses 返回 402（路由存在，对照 404 page not found），此前未声明。'
  },
  {
    id: 'ppio',
    protocol: 'responses',
    reason: '2026-10-21 实测 /v3/openai/v1/responses 返回 404 MODEL_NOT_FOUND（路由存在），对照路径 404 page not found。'
  },
  {
    id: 'ppio',
    protocol: 'messages',
    reason: '2026-10-21 厂商逐模型声明 anthropic 端点；/v3/anthropic 前缀整体 403 余额校验，未实测通过。'
  },
  {
    id: 'openrouter',
    protocol: 'responses',
    reason: '2026-10-21 带 Key 实测 /api/v1/responses 返回 200（此前未声明）。'
  },
  {
    id: 'ocoolai',
    protocol: 'messages',
    reason: '2026-10-21 带 Key 实测 `POST /v1/messages` 对 claude-sonnet-4 返回 200；同批把死掉的 api.ocoolai.com 换成 one.ocoolai.com。'
  },
  {
    id: 'moonshot',
    protocol: 'responses',
    reason: '2026-10-21 带 Key 实测 /v1/responses 对 kimi-k3 返回 200，此前未声明。'
  },
  {
    id: 'deepseek',
    protocol: 'responses',
    reason: '2026-10-21 带 Key 实测 `/v1/responses` 对 deepseek-flash / deepseek-v4-pro 返回 200，此前未声明。'
  }
]

const PROTOCOLS: readonly ModelChatProtocol[] = ['chat-completions', 'responses', 'messages', 'gemini']

/**
 * 快照之后**新增**的预设：它们本来就不在 golden 里，逐字段比对时跳过。
 * 每加一家新供应商把 id 写进来，比往快照里补一个"伪历史对象"更诚实。
 */
const PRESETS_ADDED_AFTER_SNAPSHOT: readonly string[] = ['tokenhub']

describe('PLAT-72 provider presets golden snapshot', () => {
  it('keeps every non-endpoint preset field, value and order identical to the pre-refactor snapshot', () => {
    const goldenIds = new Set(golden.map((preset) => String(preset.id)))
    // toStrictEqual：连 undefined 字段的有无都纳入比较（toEqual 会忽略）。
    expect(legacyProjection(currentPresets().filter((preset) => goldenIds.has(String(preset.id)))))
      .toStrictEqual(legacyProjection(golden as unknown as Array<Record<string, unknown>>))
  })

  it('accounts for every preset added after the snapshot', () => {
    const goldenIds = new Set(golden.map((preset) => String(preset.id)))
    const added = currentPresets().map((preset) => String(preset.id)).filter((id) => !goldenIds.has(id))
    expect(added.sort()).toEqual([...PRESETS_ADDED_AFTER_SNAPSHOT].sort())
  })

  it('derives exactly the same endpoint base per protocol as the pre-refactor implementation', () => {
    const current = new Map(createSystemProviderPresets().map((preset) => [preset.id, preset]))

    for (const snapshot of golden) {
      const preset = current.get(snapshot.id)
      expect(preset, `missing preset ${snapshot.id}`).toBeDefined()
      for (const protocol of PROTOCOLS) {
        const intentional = INTENTIONAL_ENDPOINT_CHANGES.some(
          (entry) => entry.id === snapshot.id && entry.protocol === protocol
        )
        if (intentional) continue
        expect(normalize(resolveProviderChatBase(preset!, protocol)), `${snapshot.id}:${protocol}`)
          .toBe(legacyEndpointBase(snapshot, protocol))
      }
      // 登记的改动必须真的改过，且必须是"从空到有地址"这一种——否则说明登记过期了。
      for (const entry of INTENTIONAL_ENDPOINT_CHANGES.filter((change) => change.id === snapshot.id)) {
        expect(legacyEndpointBase(snapshot, entry.protocol), `${entry.id}:${entry.protocol} 旧值`).toBe('')
        expect(normalize(resolveProviderChatBase(preset!, entry.protocol)), `${entry.id}:${entry.protocol} 新值`)
          .not.toBe('')
      }
      // 主地址（登录/就绪判断读它）也没变。
      expect(resolveProviderPrimaryBase(preset!), `${snapshot.id} primary base`)
        .toBe(normalize(snapshot.baseUrl))
    }
  })

  it('lists endpoints in a total order with the default endpoint first', () => {
    // 默认端点 = `endpoints[0]`：只有原生协议的官方预设不是 chat/completions。
    const nonChatDefault = new Map<string, ModelChatProtocol>([
      ['anthropic', 'messages'],
      ['openai', 'responses'],
      ['gemini', 'gemini']
    ])
    for (const preset of createSystemProviderPresets()) {
      const endpoints = preset.endpoints as ProviderChatEndpoint[]
      expect(endpoints.length, preset.id).toBeGreaterThan(0)
      expect(endpoints[0]?.protocol, preset.id).toBe(nonChatDefault.get(preset.id) ?? 'chat-completions')
      // 清单内部协议唯一，且每条都带已归一化的 base（空串 = 已声明未配置）。
      expect(new Set(endpoints.map((endpoint) => endpoint.protocol)).size, preset.id).toBe(endpoints.length)
      for (const endpoint of endpoints) {
        expect(endpoint.baseUrl, `${preset.id}:${endpoint.protocol}`).toBe(normalize(endpoint.baseUrl))
      }
    }
  })

  it('pins the preset inventory the snapshot was taken from', () => {
    expect(golden).toHaveLength(43)
    expect(golden.reduce((total, preset) => total + preset.models.length, 0)).toBe(137)
    // 全局顺序 = 预设分组顺序（relay → domestic → international → local → gateway）；
    // 组内顺序 = 各 `presets/<category>.ts` 的书写顺序。快照数组同序，逐位对比。
    expect(golden.map((preset) => preset.id)).toEqual([
      // relay
      'silicon', 'tokenrhythm', 'aihubmix', 'ocoolai', 'aionly', 'burncloud',
      'cephalon', 'lanyun', 'ph8', 'sophnet', 'openrouter', 'poe',
      // domestic
      'zhipu', 'deepseek', 'ppio', 'dashscope', 'minimax', 'moonshot', 'qiniu', 'doubao', 'baichuan',
      'stepfun', 'modelscope', 'longcat', 'mimo',
      // international
      'zai', 'minimax-global', 'anthropic', 'openai', 'gemini', 'groq', 'together', 'fireworks',
      'nvidia', 'grok', 'hyperbolic', 'mistral',
      'cerebras',
      // local
      'ovms', 'ollama', 'lmstudio', 'gpustack',
      // gateway
      'new-api'
    ])
  })

  it('keeps the endpoint facts that used to live in config', () => {
    const byId = new Map(createSystemProviderPresets().map((preset) => [preset.id, preset]))

    // anthropic 端点：24 家与主地址同址、14 家异址。异址的必须仍是"异址"。
    const sameAddress = golden.filter((preset) => preset.anthropicBaseUrl !== undefined
      && normalize(preset.anthropicBaseUrl) === normalize(preset.baseUrl))
    const overridden = golden.filter((preset) => preset.anthropicBaseUrl !== undefined
      && normalize(preset.anthropicBaseUrl) !== normalize(preset.baseUrl))
    expect({ same: sameAddress.length, overridden: overridden.length }).toEqual({ same: 20, overridden: 13 })
    expect(overridden.map((preset) => preset.id)).toEqual([
      'cephalon', 'openrouter',
      'zhipu', 'deepseek', 'dashscope', 'minimax', 'moonshot', 'doubao', 'modelscope', 'longcat', 'mimo',
      'zai', 'minimax-global'
    ])
    expect(resolveProviderChatBase(byId.get('cephalon')!, 'messages'))
      .toBe('https://cephalon.cloud/user-center/v1')

    // 旧预设层 extraEndpoints：responses×10 + gemini×1（现在就是端点清单里的 responses/gemini 行）。
    const endpointKinds = golden.flatMap((preset) =>
      Object.keys(preset.extraEndpoints ?? {}).map((kind) => `${preset.id}:${kind}`))
    expect(endpointKinds).toEqual([
      'tokenrhythm:responses', 'lanyun:responses', 'ph8:responses', 'poe:responses',
      'doubao:responses', 'modelscope:responses',
      'openai:responses', 'gemini:gemini', 'fireworks:responses', 'nvidia:responses', 'grok:responses'
    ])
    for (const preset of golden) {
      for (const kind of Object.keys(preset.extraEndpoints ?? {})) {
        const protocol: ModelChatProtocol = kind === 'gemini' ? 'gemini' : 'responses'
        expect(resolveProviderChatBase(byId.get(preset.id)!, protocol), `${preset.id}:${kind}`)
          .toBe(normalize(preset.extraEndpoints?.[kind]))
      }
    }

    // 预设模型协议 = 供应商默认端点（`endpoints[0]`）的快照：只有原生协议的三家不是 chat/completions。
    const native = new Set(['anthropic', 'openai', 'gemini'])
    for (const preset of byId.values()) {
      const chatModels = preset.models.filter((model) => model.capabilities.chat)
      for (const model of chatModels) {
        expect(model.chatProtocol, `${preset.id}/${model.id}`)
          .toBe(native.has(preset.id) ? preset.endpoints[0]?.protocol : 'chat-completions')
      }
      // 非 chat 模型不得带聊天协议（否则模型抽屉会显示一个用不了的选项）。
      for (const model of preset.models.filter((entry) => !entry.capabilities.chat)) {
        expect(model.chatProtocol, `${preset.id}/${model.id}`).toBeUndefined()
      }
    }
  })

  it('keeps preset model bookkeeping intact', () => {
    for (const preset of golden) {
      const modelIds = preset.models.map((model) => model.id)
      expect(new Set(modelIds).size, `duplicate model id in ${preset.id}`).toBe(modelIds.length)
      for (const model of preset.models) {
        expect(model.presetModel, `${preset.id}/${model.id} must be marked presetModel`).toBe(true)
        expect(model.provider, `${preset.id}/${model.id} must carry its provider id`).toBe(preset.id)
        // 图片/视频等非 chat 模型不得带默认聊天协议（否则模型抽屉会乱）。
        if (model.chatProtocol !== undefined) {
          expect(model.capabilities.chat, `${preset.id}/${model.id} chatProtocol requires chat`).toBe(true)
        }
      }
      const defaultModelId = preset.defaultChatModelId
      if (defaultModelId !== undefined) {
        expect(modelIds, `${preset.id} defaultChatModelId must exist`).toContain(defaultModelId)
      }
    }
  })

  it('keeps every preset id unique and addressed to the current preset catalog', () => {
    const ids = golden.map((preset) => preset.id)
    expect(new Set(ids).size).toBe(ids.length)
    // 快照之后新增的预设不在 golden 里，单独放行。
    expect(new Set(ids)).toEqual(
      new Set(createSystemProviderPresets().map((preset) => preset.id).filter((id) => !PRESETS_ADDED_AFTER_SNAPSHOT.includes(id)))
    )
    // 预设输出只允许端点清单字段（`endpoints` / `imageEndpoints`），不允许出现"另一份事实"。
    const allowedExtras = new Set(['endpoints', 'imageEndpoints'])
    const goldenKeys = new Set(Object.keys(golden[0]!))
    for (const preset of currentPresets()) {
      const extras = Object.keys(preset).filter((key) => !goldenKeys.has(key))
      expect(extras.filter((key) => !allowedExtras.has(key)), `preset ${String(preset.id)} unexpected field`).toEqual([])
    }
  })
})

function unique<T>(values: readonly (T | undefined)[]): T[] {
  return Array.from(new Set(values.filter((value): value is T => value !== undefined)))
}
